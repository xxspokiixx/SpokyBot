package com.openmausbot.test

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.webkit.CookieManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class NodeHostService : Service() {

    private lateinit var scope: CoroutineScope
    private var nodeProcess: Process? = null
    private var restarts = 0
    private var stopping = false
    private val booting = java.util.concurrent.atomic.AtomicBoolean(false)

    /** The OpenCode key from config.json, mirrored into the server's env at boot:
     * the server itself only mirrors config → env on a settings patch, so a
     * restarted server would otherwise lose it until the next save. */
    private var openCodeApiKey: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        createChannel()
        Log.d(TAG, "onCreate")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action} startId=$startId phase=${NodeState.status.value.phase}")
        if (intent?.action == ACTION_STOP) {
            stopNode()
            NodeState.update(NodeState.Phase.Idle, detail = "stopped by user")
            stopSelf(startId)
            return START_NOT_STICKY
        }
        startAsForeground()
        if (NodeState.status.value.phase == NodeState.Phase.Ready) {
            postNotification(getString(R.string.notif_ready))
            // The server is already up, but this WebView may have no session: a reinstall clears its
            // cookie store while the data folder, and the sessions registry inside it, survive. Pairing
            // only ran on the boot that started the server, so without this the page opens on the
            // pairing screen and stays there. pairWebView starts its own coroutine.
            pairWebView()
            return START_STICKY
        }
        scope.launch { runBoot() }
        return START_STICKY
    }

    override fun onTimeout(startId: Int) {
        stopNode()
        NodeState.update(NodeState.Phase.Stopped, detail = "foreground time limit reached")
        postNotification(getString(R.string.notif_paused), withStop = false, withResume = true)
    }

    override fun onDestroy() {
        Log.d(TAG, "onDestroy")
        if (instance === this) instance = null
        stopping = true
        stopNode()
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun runBoot() {
        Log.d(TAG, "runBoot starting")
        val bootUnderway = NodeState.samePhase(
            NodeState.Phase.Extracting,
            NodeState.Phase.Starting,
            NodeState.Phase.Running,
            NodeState.Phase.Ready,
        )
        if (bootUnderway && nodeProcess?.isAlive == true) {
            Log.d(TAG, "runBoot returning early: bootUnderway=$bootUnderway nodeAlive=${nodeProcess?.isAlive}")
            return
        }
        if (!booting.compareAndSet(false, true)) {
            Log.d(TAG, "runBoot returning early: booting already true")
            return
        }
        try {
            if (nodeProcess?.isAlive == true) stopNode()
            stopping = false
            Log.d(TAG, "runBoot: extracting if needed")
            NodeState.update(NodeState.Phase.Extracting, detail = getString(R.string.status_extracting))
            val installError = extractIfNeeded()
            Log.d(TAG, "runBoot: extractIfNeeded returned: ${installError ?: "null"}")
            if (installError != null) {
                NodeState.update(NodeState.Phase.BundleMissing, detail = installError)
                postNotification(getString(R.string.notif_bundle_missing), withStop = false, withResume = true)
                return
            }
            // Use the manually extracted node runtime (more reliable than nativeLibraryDir)
            val nodeRuntime = extractNodeRuntime()
            val node = nodeRuntime ?: File(applicationInfo.nativeLibraryDir, NODE_LIB)
            Log.d(TAG, "runBoot: node exists=${node.exists()} path=${node.absolutePath} size=${node.length()}")
            if (!node.exists() || node.length() < 1_000_000) {
                NodeState.update(NodeState.Phase.RuntimeMissing, detail = getString(R.string.status_runtime_missing))
                postNotification(getString(R.string.notif_runtime_missing), withStop = false, withResume = true)
                return
            }
            Log.d(TAG, "runBoot: copying SSH keys from assets")
            copySshKeysFromAssets()
            Log.d(TAG, "runBoot: cleaning stale leases")
            cleanupStaleLeases()
            Log.d(TAG, "runBoot: killing port hoggers")
            killPortHoggers()
            // Give the OS time to release the port after killing hoggers
            Thread.sleep(500)
            Log.d(TAG, "runBoot: ensuring server config")
            ensureServerConfig(node.absolutePath)
            Log.d(TAG, "runBoot: ensuring local computer")
            // The rootfs is only the phone's "this computer". A phone whose storage is full, or whose SELinux policy
            // refuses the links the archive holds, still runs every bot; it loses that one destination, and says why.
            ensureLocalComputer(node.absolutePath)?.let { failure ->
                Log.w(TAG, "local computer unavailable: $failure")
                NodeState.status.update { it.copy(detail = "this computer is unavailable: $failure") }
            }
            Log.d(TAG, "runBoot: starting node")
            startNode(node.absolutePath)
            Log.d(TAG, "runBoot: polling server")
            pollServer()
        } finally {
            booting.set(false)
        }
    }

    /** Copies SSH keys from assets (omb/ssh/) to the data directory for VPS connections.
     * The VPS SSH setup expects keys at dataDir/ssh/ to be available for user@host auth. */
    private fun copySshKeysFromAssets() {
        val dataDir = File(filesDir, "data")
        val sshDir = File(dataDir, "ssh")
        try {
            val assets = resources.assets
            val assetSshDir = "omb/ssh"
            val assetFiles = assets.list(assetSshDir)
            if (assetFiles == null || assetFiles.isEmpty()) {
                Log.d(TAG, "No SSH keys in assets to copy")
                return
            }
            sshDir.mkdirs()
            var copied = 0
            for (name in assetFiles) {
                val source = "$assetSshDir/$name"
                val target = File(sshDir, name)
                try {
                    assets.open(source).use { input ->
                        target.outputStream().use { output -> input.copyTo(output) }
                    }
                    target.setExecutable(false)
                    target.setReadable(true, false)
                    copied++
                } catch (e: IOException) {
                    Log.w(TAG, "Failed to copy SSH key $name: ${e.message}")
                }
            }
            if (copied > 0) {
                Log.d(TAG, "Copied $copied SSH key(s) from assets to data/ssh/")
            }
        } catch (e: Exception) {
            Log.w(TAG, "SSH key copy failed: ${e.message}")
        }
    }

    /** Removes stale data-directory lease files left by a previous crash.
     * The server's lease logic treats EPERM from process.kill(pid,0) as "process alive",
     * which on Android happens for any PID the app doesn't own — causing false positives
     * that block startup. We clean the lease files here so the server can acquire a fresh lease. */
    private fun cleanupStaleLeases() {
        val dataDir = File(filesDir, "data")
        val leaseFile = File(dataDir, "openmausbot-server.lease")
        val childLeaseDir = File(dataDir, ".openmausbot-server-child")
        if (leaseFile.exists()) {
            try {
                leaseFile.delete()
                NodeState.update(detail = "removed stale server lease")
            } catch (e: Exception) {
                NodeState.update(detail = "failed to remove stale lease: ${e.message}")
            }
        }
        if (childLeaseDir.exists()) {
            try {
                childLeaseDir.deleteRecursively()
                NodeState.update(detail = "removed stale child lease dir")
            } catch (e: Exception) {
                NodeState.update(detail = "failed to remove stale child lease dir: ${e.message}")
            }
        }
    }

    /** Kills any process listening on the server port (8799) to avoid EADDRINUSE
     * on restart. Uses `fuser -k` or `ss -ltnp` + kill if available. */
    private fun killPortHoggers() {
        try {
            val port = 8799
            Log.d(TAG, "port cleanup: starting")
            NodeState.update(detail = "port cleanup: starting")
            // Try fuser first (most direct)
            val fuser = ProcessBuilder(listOf("fuser", "-k", "${port}/tcp"))
                .redirectErrorStream(true)
                .start()
            fuser.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)
            Log.d(TAG, "port cleanup: fuser done")
            NodeState.update(detail = "port cleanup: fuser done")
            // Fallback: ss + kill
            val ss = ProcessBuilder(listOf("ss", "-ltnp", "sport", "=", port.toString()))
                .redirectErrorStream(true)
                .start()
            val output = ss.inputStream.bufferedReader().use { it.readText() }
            ss.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)
            Log.d(TAG, "port cleanup: ss output=${output.take(200)}")
            NodeState.update(detail = "port cleanup: ss output=${output.take(200)}")
            // Parse PIDs from ss output like: users:(("libnodeexec.so",pid=12345,fd=6))
            val pidRegex = """pid=(\d+)""".toRegex()
            for (match in pidRegex.findAll(output)) {
                val pid = match.groupValues[1].toIntOrNull()
                if (pid != null) {
                    try {
                        ProcessBuilder(listOf("kill", "-9", pid.toString())).start().waitFor(1, java.util.concurrent.TimeUnit.SECONDS)
                        Log.d(TAG, "port cleanup: killed pid=$pid")
                        NodeState.update(detail = "port cleanup: killed pid=$pid")
                    } catch (_: Exception) {}
                }
            }
            // Also try killall for libnodeexec.so as last resort
            ProcessBuilder(listOf("killall", "-9", "libnodeexec.so")).start().waitFor(1, java.util.concurrent.TimeUnit.SECONDS)
            Log.d(TAG, "port cleanup: killall done")
            NodeState.update(detail = "port cleanup: killall done")
        } catch (e: Exception) {
            Log.e(TAG, "port cleanup warning: ${e.message}")
            NodeState.update(detail = "port cleanup warning: ${e.message}")
        }
    }

    /**
     * The desktop stack is launched detached, so nothing owns it: when the payload is replaced it
     * survives with deleted binaries and still answers on the X display and the viewer ports.
     * An app cannot enumerate other processes, but /proc is readable and every guest command
     * names the rootfs, so the stack is found by its own argv and stopped.
     */
    private fun stopRunningGuest() {
        val marker = File(filesDir, LINUX_DIR).absolutePath
        val self = android.os.Process.myPid()
        val killed = mutableListOf<Int>()
        // Bounded: a /proc entry that cannot be read (SELinux denies another uid's cmdline, or the process left between
        // the listing and the read) must cost nothing, and the whole sweep is over in a second on a phone.
        val deadline = System.currentTimeMillis() + 5_000
        for (entry in File("/proc").listFiles() ?: return) {
            if (System.currentTimeMillis() > deadline) break
            val pid = entry.name.toIntOrNull() ?: continue
            if (pid == self) continue
            val cmdline = runCatching {
                // A byte array, not a stream: readText on a foreign cmdline can block on Android, and this runs at boot.
                java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(entry.path, "cmdline")).toString(Charsets.UTF_8).replace('\u0000', ' ')
            }.getOrNull() ?: continue
            if (!cmdline.contains(marker)) continue
            if (runCatching { android.os.Process.sendSignal(pid, android.os.Process.SIGNAL_KILL) }.isSuccess) {
                killed.add(pid)
            }
        }
        if (killed.isNotEmpty()) {
            val waitUntil = System.currentTimeMillis() + 3_000
            while (System.currentTimeMillis() < waitUntil && killed.any { File("/proc/$it").exists() }) {
                runCatching { Thread.sleep(100) }
            }
        }
        // The X server holds its display lock in a file the extraction is about to remove; without
        // clearing it the next Xvfb refuses to start on :3.
        val linux = File(filesDir, LINUX_DIR)
        runCatching { File(linux, "rootfs/tmp/.X3-lock").delete() }
        runCatching { File(linux, "tmp/.X3-lock").delete() }
        runCatching { File(linux, "tmp/.X11-unix/X3").delete() }
    }

    /**
     * Empties a folder before it is staged again. SELinux denies `unlink` on some staged asset names, and a
     * `Files.walkFileTree` that meets one keeps visiting the same directory until the app is killed: this deletes what
     * it can, then lets `/system/bin/rm` do the rest, and never blocks past the cap. Best effort by design: the staging
     * that follows re-extracts everything, and a file left behind is overwritten.
     *
     * A folder an earlier extraction left as root is one this uid cannot empty. That is reported and stepped over: the
     * extraction writes a new `rootfs-staging` beside it and renames it into place, which needs no delete. Nothing here
     * asks a root shell for help — `su` waits for a person to approve it, and nothing may wait on that during a boot.
     */
    private fun wipeDirectory(dir: File) {
        if (!dir.exists()) return
        runCatching {
            val deadline = System.currentTimeMillis() + 60_000
            dir.listFiles()?.forEach { entry ->
                if (System.currentTimeMillis() > deadline) return@forEach
                runCatching { entry.deleteRecursively() }
            }
        }
        if (!dir.exists()) return
        runCatching {
            val proc = ProcessBuilder("/system/bin/rm", "-rf", dir.absolutePath).redirectErrorStream(true).start()
            // The pipe is drained on its own thread: a full buffer would otherwise wedge rm with the app waiting on it.
            val drain = Thread { runCatching { proc.inputStream.bufferedReader().forEachLine { } } }
            drain.isDaemon = true
            drain.start()
            if (!proc.waitFor(3, java.util.concurrent.TimeUnit.MINUTES)) proc.destroyForcibly()
            drain.join(2_000)
        }
        if (dir.exists()) {
            Log.w(TAG, "wipeDirectory: ${dir.absolutePath} could not be emptied (not this app's files); carrying on beside it")
            NodeState.update(detail = "keeping past files in ${dir.name}")
        }
    }

    /** Stages the phone's "this computer" (see android-test/linux/): a proot'ed
     * Alpine rootfs plus the MCP server the harness gate launches for a bot that
     * picks "this computer" as its working destination. Returns an error only for a
     * payload that exists but is broken (a corrupt rootfs); a build without the
     * linux assets stays on the graceful shell-only path. */
    private fun ensureLocalComputer(nodePath: String): String? {
        val linux = File(filesDir, LINUX_DIR)
        val mcp = File(linux, "android-local-computer.mjs")
        try {
            val version = assets.open("$OMB_ASSET_DIR/VERSION").bufferedReader().use { it.readText().trim() }
            // Only the linux part of the build names this payload: `omb-test-<app>-server<sha>-ui<sha>-linux<sha>`. A new
            // server or UI bundle leaves the rootfs exactly as it is, and re-extracting 471 MB on a phone for a change
            // that did not touch it costs minutes of the person's time.
            val linuxVersion = version.substringAfterLast("-linux", "").let { if (it.isEmpty()) version else "linux$it" }
            val stamp = File(linux, "STAMP")
            val stampText = runCatching { stamp.readText().trim() }.getOrDefault("")
            // A stamp written by an older build holds the whole version: its linux part is read out of it.
            val stampLinux = if (stampText.contains("-linux")) stampText.substringAfterLast("-linux", "").let { "linux$it" } else stampText
            if (!mcp.exists() || stampLinux != linuxVersion) {
                stopRunningGuest()
                // Attempts that were killed mid-extraction leave their own whole copies of the rootfs here. They are
                // this app's own leftovers, and the extraction that follows needs the room.
                linux.listFiles()?.filter { it.name.startsWith("rootfs-old-") }?.forEach { wipeDirectory(it) }
                wipeDirectory(linux)
                linux.mkdirs()
                copyAssetDir(assets, "$OMB_ASSET_DIR/linux", linux)
                val rootfs = File(linux, "rootfs")
                wipeDirectory(rootfs)
                val rootfsStaging = File(linux, "rootfs-staging")
                wipeDirectory(rootfsStaging)
                rootfsStaging.mkdirs()
                // aapt decompresses *.gz assets, so the tarball ships as rootfs.blob —
                // still a gzip stream either way; plain tars arrive from older builds.
                val tarball = File(linux, "rootfs.blob").takeIf { it.exists() }
                    ?: File(linux, "rootfs.tar.gz").takeIf { it.exists() }
                    ?: File(linux, "rootfs.tar")
                val tarFlags = if (tarball.name == "rootfs.blob" || tarball.name.endsWith(".gz")) listOf("-xzf") else listOf("-xf")
                // The archive's /dev holds device nodes (ptmx, console, random, …) whose creation
                // needs CAP_MKNOD — a capability neither the app nor ADB/Shizuku's shell user has on
                // Android, so extracting them fails with EPERM. proot -R bind-mounts the host /dev
                // into the guest, making the archive's nodes redundant; skip them and recreate the
                // empty mountpoint below.
                val exclude = File(linux, "tar-exclude.txt").apply { writeText("./dev/*\n") }
                // `--no-same-owner`: the archive's ids mean nothing to an app's uid, and chown is refused outright.
                // Hardlinks in the archive cannot be made either (SELinux denies `link` on newer Android), so tar is
                // told to keep going past them: a file that loses its hardlink is still extracted whole, which is all
                // the guest needs, and the exit code alone is not what says whether the tree arrived.
                val tar = ProcessBuilder(listOf("/system/bin/tar", "-C", rootfsStaging.absolutePath, "-X", exclude.absolutePath, "--no-same-owner") + tarFlags + listOf(tarball.absolutePath))
                    .redirectErrorStream(true)
                    .start()
                val tarOutput = StringBuffer()
                val drain = Thread {
                    runCatching { tar.inputStream.bufferedReader().forEachLine { line -> tarOutput.appendLine(line) } }
                }
                drain.start()
                // A damaged archive can leave tar spinning with the pipe open: cap the
                // wait so one bad release asset surfaces as Failed, not a wedged boot.
                if (!tar.waitFor(15, java.util.concurrent.TimeUnit.MINUTES)) {
                    tar.destroyForcibly()
                    drain.join(5_000)
                    return "linux environment extraction timed out after 15 minutes: ${tarOutput.toString().takeLast(300)}"
                }
                drain.join(5_000)
                // What says the tree arrived is the tree, not tar's exit code: a hardlink it was refused is reported as
                // an error while the file itself is written whole, and a phone does not need the link.
                val stagingRoot = File(rootfsStaging, "usr")
                val stagingBin = File(rootfsStaging, "bin")
                if (!stagingRoot.isDirectory && !stagingBin.isDirectory) {
                    return "linux environment extraction failed: ${tarOutput.toString().takeLast(300)}"
                }
                if (tar.exitValue() != 0) {
                    Log.w(TAG, "tar exited ${tar.exitValue()} but the tree is there: ${tarOutput.toString().takeLast(300)}")
                }
                if (rootfs.exists()) {
                    val stale = File(linux, "rootfs-old-${System.currentTimeMillis()}")
                    if (!rootfs.renameTo(stale)) {
                        return "linux environment extraction failed: could not clear previous rootfs"
                    }
                    // Cleared right here, not later: a folder left behind is one more copy of the rootfs on a phone, and
                    // the next extraction has to fit beside it.
                    wipeDirectory(stale)
                }
                if (!rootfsStaging.renameTo(rootfs)) {
                    return "linux environment extraction failed: could not move staging rootfs into place"
                }
                tarball.delete()
                // --exclude skips the archive's /dev directory too; proot -R needs an empty guest
                // mountpoint to bind the host /dev onto.
                File(rootfs, "dev").mkdirs()
                // copyAssetDir streams bytes only: every exec-able file in the
                // payload needs its mode restored, or execve answers EACCES.
                File(linux, "proot").setExecutable(true, false)
                File(linux, "loader").setExecutable(true, false)
                File(linux, "omb-guest-chromium").setExecutable(true, false)
                // The engines a person can pick in Settings: a key for one of them is useless until
                // its CLI runs here, and the extractor leaves these at mode 0600.
                for (engine in ENGINE_BINARIES) {
                    File(linux, engine).takeIf { it.isFile }?.setExecutable(true, false)
                }
                stamp.writeText(linuxVersion)
            }
            val workspace = File(filesDir, WORKSPACE_DIR).apply { mkdirs() }
            val dataDir = File(filesDir, DATA_DIR_NAME).apply { mkdirs() }
            File(linux, "tmp").apply { mkdirs() }
            // Restored on every start, not only after an extraction: a payload staged before an
            // engine was added leaves that engine without its exec bit, and the server then
            // reports the engine as unavailable for the whole life of the install.
            for (engine in ENGINE_BINARIES) {
                File(linux, engine).takeIf { it.isFile }?.setExecutable(true, false)
            }
            writeGuestResolvConf(File(linux, "rootfs"))
            val userData = File(filesDir, USER_DATA_DIR).apply { mkdirs() }
            val descriptor = File(userData, "cua-connection.json")
            val mcpEnv = mapOf(
                "OMB_ANDROID_LINUX_DIR" to linux.absolutePath,
                "OMB_ANDROID_ROOTFS" to File(linux, "rootfs").absolutePath,
                "OMB_ANDROID_WORKSPACE" to workspace.absolutePath,
                "OMB_ANDROID_DATA_DIR" to dataDir.absolutePath,
                "OMB_EXTRA_PATH" to linux.absolutePath,
                "OMB_ANDROID_TMP_DIR" to File(linux, "tmp").absolutePath,
            )
            descriptor.writeText(
                "{" +
                    "\"mode\":\"embedded\"," +
                    "\"socketPath\":\"${escapeJson(File(linux, "local-computer.sock").absolutePath)}\"," +
                    "\"mcpCommand\":\"${escapeJson(nodePath)}\"," +
                    "\"mcpArgs\":[\"mcp\",\"${escapeJson(mcp.absolutePath)}\"]," +
                    "\"mcpEnv\":{" +
                    mcpEnv.entries.joinToString(",") { "\"${it.key}\":\"${escapeJson(it.value)}\"" } +
                    "}," +
                    "\"status\":\"ready\"}",
            )
            java.nio.file.Files.setPosixFilePermissions(
                descriptor.toPath(),
                java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"),
            )
            // Recorded self-test: proves the app-domain exec path (proot + guest bash)
            // end to end; a stale or absent file means the environment never ran.
            runCatching {
                fun probe(label: String, command: List<String>): String {
                    return try {
                        val proc = ProcessBuilder(command)
                            .apply {
                                environment()["LD_LIBRARY_PATH"] = linux.absolutePath
                                environment()["PROOT_TMP_DIR"] = File(linux, "tmp").absolutePath
                                environment()["PROOT_NO_SECCOMP"] = "1"
                                environment()["PROOT_ASSUME_MEMFD_UNSUPPORTED"] = "1"
                                environment()["PROOT_LOADER"] = File(linux, "loader").absolutePath
                            }
                            .redirectErrorStream(true)
                            .start()
                        val output = StringBuffer()
                        val drain = Thread {
                            runCatching { proc.inputStream.bufferedReader().forEachLine { line -> output.appendLine(line) } }
                        }
                        drain.start()
                        if (!proc.waitFor(60, java.util.concurrent.TimeUnit.SECONDS)) {
                            proc.destroyForcibly()
                            drain.join(2_000)
                            return "[$label] timed out after 60 s\n"
                        }
                        drain.join(2_000)
                        "[$label] exit=${proc.exitValue()}: ${output.toString().trim().take(400)}\n"
                    } catch (e: Exception) {
                        "[$label] threw: ${e.message}\n"
                    }
                }
                val rootfs = File(linux, "rootfs")
                val report = StringBuilder()
                report.append(probe("musl-loader-direct", listOf(File(rootfs, "lib/ld-musl-aarch64.so.1").absolutePath, "--version")))
                report.append(probe("bash-direct", listOf(File(rootfs, "bin/bash").absolutePath, "--version")))
                report.append(
                    probe(
                        "proot-loader-bash",
                        listOf(
                            File(linux, "proot").absolutePath,
                            "-R", rootfs.absolutePath,
                            "-b", "${workspace.absolutePath}:/work",
                            "-w", "/work",
                            "/bin/bash", "-lc", "echo linux-ok; uname -a; python3 --version",
                        ),
                    ),
                )
                File(linux, "SELFTEST").writeText(report.toString())
            }
            return null
        } catch (e: IOException) {
            NodeState.update(detail = "linux environment setup failed: ${e.message}")
            return null
        }
    }

    /** The guest has no /etc/resolv.conf of its own and Android has none for proot's
     * recommended binds to shadow it with, so DNS would be dead. Rewrite the file on
     * every boot with the active network's resolvers, falling back to public ones —
     * the kernel network is shared, so the guest only ever needed the nameservers. */
    private fun writeGuestResolvConf(rootfs: File) {
        runCatching {
            val servers = mutableListOf<String>()
            val manager = getSystemService(CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            val link = manager?.activeNetwork?.let { manager.getLinkProperties(it) }
            for (dns in link?.dnsServers ?: emptyList()) servers.add(dns.hostAddress ?: continue)
            if ("127.0.0.1" in servers) servers.remove("127.0.0.1")
            servers.addAll(listOf("8.8.8.8", "1.1.1.1"))
            File(rootfs, "etc").mkdirs()
            File(rootfs, "etc/resolv.conf").writeText(servers.distinct().joinToString("") { "nameserver $it\n" })
        }
    }

    /** OMB hides the OpenCode engine from devices that configured their own
     * instances (the phone lane's guest ships the opencode CLI, so the user's
     * "set up OpenCode login and use its models" needs the instance present).
     * Text-surgery insert, like the cli repair: user content stays untouched. */
    private fun ensureOpenCodeInstance(config: File) {
        runCatching {
            val text = config.readText()
            // The top-level opencodeGo API-key section shares the name; only the
            // engine instance ("driver" inside it) proves the instance exists.
            if (Regex("\"opencodeGo\"\\s*:\\s*\\{\\s*\"driver\"").containsMatchIn(text)) return
            val match = Regex("\"instances\"\\s*:\\s*\\{").find(text) ?: return
            val at = match.range.last + 1
            val emptyInstances = text.drop(at).trimStart().startsWith("}")
            val entry = if (emptyInstances) "\"opencodeGo\":{\"driver\":\"opencodeGo\"}" else "\"opencodeGo\":{\"driver\":\"opencodeGo\"},"
            config.writeText(text.substring(0, at) + entry + text.substring(at))
            NodeState.update(detail = "OpenCode engine added to config.json")
        }
    }

    /** Seeds config.json before first boot: config.json is a public contract people edit;
     * the seeded fields only enable the in-app browser (the guest's chromium, reached through
     * OMB_CHROME_PATH) plus the skills library, and point the claude instance at the bundled
     * fake engine. A later boot with an existing config.json (user engines, other edits)
     * keeps their file untouched. */
    private fun ensureServerConfig(nodePath: String) {
        val dataDir = File(filesDir, "data").apply { mkdirs() }
        val config = File(dataDir, "config.json")
        if (config.exists()) {
            repairStaleCliHead(config, nodePath)
            ensureOpenCodeInstance(config)
            openCodeApiKey = runCatching {
                org.json.JSONObject(config.readText()).optJSONObject("opencodeGo")?.optString("apiKey", "")?.ifBlank { null }
            }.getOrNull()
            NodeState.update(detail = "config.json already present; seed skipped")
            return
        }
        val engine = File(File(filesDir, INSTALL_DIR), "engine/fake-claude-cli.ts")
        try {
            config.writeText(
                "{\"features\":{\"browser\":true,\"skillsLibrary\":true}," +
                    "\"browserEngine\":{\"engine\":\"chrome\"}," +
                    "\"instances\":{" +
                    "\"opencodeGo\":{\"driver\":\"opencodeGo\"}," +
                    "\"claude\":{\"driver\":\"claudeAgent\",\"displayName\":\"SpokyBot (fixture)\"," +
                    "\"config\":{\"cli\":\"" + escapeJson("$nodePath ${engine.absolutePath}") + "\"}}," +
                    "\"nvidiaNim\":{\"driver\":\"nvidia-nim\",\"displayName\":\"NVIDIA NIM\"}}}",
            )
            NodeState.update(
                detail = if (engine.exists()) "config.json seeded (fixture engine, browser off)"
                else "config.json seeded (fixture engine file missing, browser off)",
            )
        } catch (e: IOException) {
            NodeState.update(detail = "config.json seed failed: ${e.message}")
        }
    }

    /** Android re-randomizes /data/app/~~…== on every reinstall, so a cli head baked into
     * config.json dies with the previous install; repoint it at the current runtime path.
     * Only heads naming this app's libnodeexec.so are rewritten; a user-configured CLI that
     * still exists is never touched, and the repair is a text replace so their formatting
     * and other settings survive byte for byte. */
    private fun repairStaleCliHead(config: File, nodePath: String) {
        runCatching {
            val text = config.readText()
            val instances = org.json.JSONObject(text).optJSONObject("instances") ?: return
            var repaired = text
            for (key in instances.keys()) {
                val cli = instances.optJSONObject(key)?.optJSONObject("config")?.optString("cli", "") ?: continue
                if (!cli.contains(NODE_LIB)) continue
                val head = cli.substringBefore(' ')
                if (head == nodePath || File(head).isFile) continue
                repaired = repaired.replace(head, nodePath)
            }
            if (repaired != text) {
                config.writeText(repaired)
                NodeState.update(detail = "config.json cli repointed at the current runtime install")
            }
        }
    }

    private fun escapeJson(value: String): String = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")

    private fun extractIfNeeded(): String? {
        val target = File(filesDir, INSTALL_DIR)
        val assets = resources.assets
        val version = try {
            assets.open("$OMB_ASSET_DIR/VERSION").bufferedReader().use { it.readText().trim() }
        } catch (e: IOException) {
            return getString(R.string.status_bundle_missing)
        }
        if (version.isEmpty()) return getString(R.string.status_bundle_missing)
        val installedVersion = runCatching { File(target, "VERSION").readText().trim() }.getOrDefault("")
        if (installedVersion == version) return null
        target.deleteRecursively()
        try {
            copyAssetDir(assets, OMB_ASSET_DIR, target)
        } catch (e: IOException) {
            target.deleteRecursively()
            return "asset extraction failed: ${e.message}"
        }
        File(target, "VERSION").writeText(version)
        // Also extract the native node runtime (libnodeexec.so) from the APK
        extractNodeRuntime()
        return null
    }

    /** Extracts libnodeexec.so from the APK's native library directory to the app's files directory.
     * Android doesn't reliably extract native libraries at runtime (especially executables),
     * so we do it manually using PackageManager. */
    private fun extractNodeRuntime(): File? {
        val destDir = File(filesDir, "node-runtime")
        destDir.mkdirs()
        val destFile = File(destDir, NODE_LIB)
        if (destFile.exists() && destFile.length() > 1_000_000) {
            Log.d(TAG, "Node runtime already extracted at ${destFile.absolutePath} (${destFile.length()} bytes)")
            return destFile
        }
        try {
            val pm = packageManager
            val appInfo = pm.getApplicationInfo(packageName, PackageManager.GET_SHARED_LIBRARY_FILES)
            val nativeLibDir = File(appInfo.nativeLibraryDir)
            val sourceFile = File(nativeLibDir, NODE_LIB)
            if (sourceFile.exists()) {
                Log.d(TAG, "Copying node runtime from $sourceFile to $destFile")
                sourceFile.copyTo(destFile)
                destFile.setExecutable(true, false)
                Log.d(TAG, "Node runtime extracted successfully (${destFile.length()} bytes)")
                return destFile
            } else {
                Log.w(TAG, "Native library not found at $sourceFile, nativeLibDir=$nativeLibDir")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to extract node runtime from nativeLibraryDir: ${e.message}")
        }
        // Fallback: try to find it in the APK's lib directory via PackageManager
        try {
            val pm = packageManager
            val appInfo = pm.getApplicationInfo(packageName, 0)
            // On some Android versions, nativeLibraryDir points to the unextracted APK location
            val nativeLibDir = File(appInfo.nativeLibraryDir)
            if (nativeLibDir.exists()) {
                val sourceFile = File(nativeLibDir, NODE_LIB)
                if (sourceFile.exists()) {
                    Log.d(TAG, "Copying node runtime from fallback $sourceFile to $destFile")
                    sourceFile.copyTo(destFile)
                    destFile.setExecutable(true, false)
                    Log.d(TAG, "Node runtime extracted from fallback (${destFile.length()} bytes)")
                    return destFile
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Fallback extraction also failed: ${e.message}")
        }
        return null
    }

    private fun copyAssetDir(assets: android.content.res.AssetManager, from: String, to: File) {
        to.mkdirs()
        // A folder with very many entries can answer an empty list on some devices even when it holds
        // files, which left the sprite folder created and empty. A second pass retries each child as a
        // file before it is believed to be a folder.
        var names = assets.list(from) ?: emptyArray()
        val isSprites = from == "$OMB_ASSET_DIR/$UI_DIR/pokemon"
        if (isSprites) Log.d(TAG, "copyAssetDir: sprites listing=${names.size}")
        if (names.isEmpty() && isSprites) {
            names = POKEMON_SPRITE_NAMES
            Log.d(TAG, "copyAssetDir: sprites fell back to ${names.size} names")
        }
        for (name in names) {
            val child = "$from/$name"
            val children = assets.list(child) ?: emptyArray()
            if (children.isNotEmpty()) {
                copyAssetDir(assets, child, File(to, name))
            } else {
                try {
                    assets.open(child).use { input ->
                        File(to, name).outputStream().use { output -> input.copyTo(output) }
                    }
                } catch (e: IOException) {
                    // A name that is really a folder whose listing came back empty: descend instead of failing the whole extraction.
                    copyAssetDir(assets, child, File(to, name))
                }
            }
        }
    }

    private fun startNode(nodePath: String) {
        Log.d(TAG, "startNode: ENTERED nodePath=$nodePath")
        val home = File(filesDir, "home").apply { mkdirs() }
        File(filesDir, "tmp").mkdirs()
        val install = File(filesDir, INSTALL_DIR)
        val serverDir = File(install, SERVER_DIR)
        val entry = File(serverDir, SERVER_ENTRY)
        Log.d(TAG, "startNode: install=$install serverDir=$serverDir entry=$entry entryExists=${entry.exists()}")
        if (!entry.exists()) {
            Log.e(TAG, "startNode: bundle entry missing at $entry")
            NodeState.update(NodeState.Phase.BundleMissing, detail = "bundle entry missing: $SERVER_ENTRY")
            return
        }
        val logFile = File(filesDir, "logs/server.log").apply { parentFile?.mkdirs() }
        if (logFile.length() > LOG_CAP_BYTES) logFile.delete()
        val previousTail = runCatching { logFile.readText().takeLast(LOG_TAIL_CHARS) }.getOrDefault("")
        NodeState.update(
            NodeState.Phase.Starting,
            detail = "spawning Node runtime",
            logTail = previousTail,
        )
        Log.d(TAG, "startNode: nodePath=$nodePath entry=$entry serverDir=$serverDir")
        val pb = ProcessBuilder(nodePath, entry.absolutePath)
            .directory(serverDir)
            .redirectErrorStream(true)
        pb.environment().clear()
        pb.environment().putAll(processEnv(home, install))
        Log.d(TAG, "startNode: environment=${pb.environment().keys.joinToString(",")}")
        val process = try {
            pb.start()
        } catch (e: Exception) {
            Log.e(TAG, "startNode: failed to start process: ${e.message}", e)
            NodeState.update(NodeState.Phase.Failed, detail = "failed to start node: ${e.message}")
            return
        }
        Log.d(TAG, "startNode: process started hash=${process.hashCode()}")
        nodeProcess = process
        restarts = 0
        scope.launch { tailProcess(process, logFile) }
    }

    private fun processEnv(home: File, install: File): Map<String, String> = buildMap {
        put("HOME", home.absolutePath)
        put("USERPROFILE", home.absolutePath)
        put("TMPDIR", File(filesDir, "tmp").absolutePath)
        put("TMP", File(filesDir, "tmp").absolutePath)
        put("NODE_ENV", "production")
        put("LANG", "C.UTF-8")
        put("PATH", "/system/bin:/system/xbin")
        // Browsing turns stream for minutes on reasoning models; the 3-minute
        // streaming idle default aborts those turns and the retry re-does the work.
        put("OPENMAUS_OPENAI_COMPAT_IDLE_TIMEOUT_MS", "600000")
        put("OMB_PORT", "8799")
        put("OMB_STATIC_DIR", File(install, UI_DIR).absolutePath)
        put("OMB_DATA_DIR", File(filesDir, "data").absolutePath)
        put("OMB_USER_DATA", File(filesDir, USER_DATA_DIR).absolutePath)
        // The guest payloads' shared root: the opencode engine's default cli and
        // any phone-lane consumer derives the proot chain from it, and proot
        // itself needs its bionic companions on the loader path wherever the
        // server spawns it.
        val linuxDir = File(filesDir, LINUX_DIR)
        val rootfs = File(linuxDir, "rootfs")
        val workspace = File(filesDir, WORKSPACE_DIR)
        put("OMB_ANDROID_LINUX_DIR", linuxDir.absolutePath)
        put("OMB_ANDROID_ROOTFS", rootfs.absolutePath)
        put("OMB_ANDROID_WORKSPACE", workspace.absolutePath)
        put("OMB_ANDROID_DATA_DIR", File(filesDir, DATA_DIR_NAME).absolutePath)
        put("OMB_EXTRA_PATH", File(linuxDir, "bin").absolutePath)
        put("LD_LIBRARY_PATH", linuxDir.absolutePath)
        // The proot chains the server itself spawns (the OpenCode engine) need
        // the same loader contract the MCP scripts set explicitly.
        put("PROOT_TMP_DIR", File(linuxDir, "tmp").absolutePath)
        put("PROOT_NO_SECCOMP", "1")
        put("PROOT_ASSUME_MEMFD_UNSUPPORTED", "1")
        put("PROOT_LOADER", File(linuxDir, "loader").absolutePath)
        openCodeApiKey?.let { put("OPENCODE_API_KEY", it) }
        // The phone's browser: the guest's chromium, reached through the
        // omb-guest-chromium wrapper, and Chrome's own sandbox off (the guest
        // runs under proot, without user namespaces).
        put("OMB_CHROME_PATH", File(linuxDir, "omb-guest-chromium").absolutePath)
        put("OMB_BROWSER_SANDBOX", "0")
        // Android standalone: trust local WebView without pairing
        put("OMB_ANDROID_STANDALONE", "1")
        val skills = File(install, SKILLS_DIR)
        if (skills.isDirectory) put("OMB_SKILLS_DIR", skills.absolutePath)
    }

    private fun tailProcess(process: Process, logFile: File) {
        Log.d(TAG, "tailProcess: started for hash=${process.hashCode()}")
        try {
            process.inputStream.bufferedReader().forEachLine { line ->
                runCatching {
                    if (logFile.length() > LOG_CAP_BYTES) logFile.delete()
                    logFile.appendText(line + "\n")
                }
                NodeState.status.update { it.copy(logTail = tail(it.logTail, line)) }
            }
        } catch (e: IOException) {
            Log.w(TAG, "tailProcess: IOException reading output: ${e.message}")
        }
        Log.d(TAG, "tailProcess: output stream closed, waiting for exit")
        val exit = try {
            process.waitFor()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            Log.w(TAG, "tailProcess: interrupted")
            return
        }
        Log.d(TAG, "tailProcess: process hash=${process.hashCode()} exited with code=$exit")
        if (stopping) return
        val phase = NodeState.status.value.phase
        // The server asks for a fresh start with exit 70 after an error it could not survive (server/restart.ts); a kill
        // by the system (the low-memory killer on this phone) arrives as 137 or a signal. Both are a crash, and the
        // launcher starts it again after a pause — that is the whole point of the server's crash guard.
        val crashed = exit == CRASH_EXIT_CODE || exit in KILLED_CODES
        when {
            phase == NodeState.Phase.Failed || phase == NodeState.Phase.Stopped || phase == NodeState.Phase.Idle -> return
            phase == NodeState.Phase.Ready && !crashed -> {
                NodeState.update(NodeState.Phase.Stopped, detail = "node exited (code $exit)")
                postNotification(getString(R.string.notif_stopped), withStop = false, withResume = true)
            }
            restarts < MAX_RESTARTS -> {
                restarts++
                // A crash waits longer each time (the same ladder the CLI and container launchers use), so a loop slows
                // down instead of burning the phone's battery in a tight start-fail cycle.
                val delay = RESTART_BACKOFF_MS[(restarts - 1).coerceAtMost(RESTART_BACKOFF_MS.lastIndex)]
                NodeState.status.update { it.copy(detail = "node exited (code $exit); restarting in ${delay / 1000} s") }
                scope.launch {
                    kotlinx.coroutines.delay(delay)
                    if (!stopping) runBoot()
                }
            }
            else -> {
                NodeState.update(
                    NodeState.Phase.Failed,
                    detail = "node exited (code $exit) repeatedly; giving up after $MAX_RESTARTS attempts",
                )
                postNotification(getString(R.string.notif_failed), withStop = false, withResume = true)
            }
        }
    }

    private fun tail(current: String, line: String): String = (current + "\n" + line).takeLast(LOG_TAIL_CHARS)
    private suspend fun pollServer() {
        if (!pollUntilAnswering()) return
        NodeState.update(NodeState.Phase.Running, detail = "port answering")
        if (!waitEnvironment()) {
            NodeState.update(
                NodeState.Phase.Failed,
                detail = "no 200 with environmentId from /.well-known/openmausbot/environment within 30 s",
            )
            postNotification(getString(R.string.notif_failed), withStop = false, withResume = true)
            return
        }
        restarts = 0
        NodeState.update(NodeState.Phase.Ready, detail = "harness ready")
        postNotification(getString(R.string.notif_ready))
        pairWebView()
    }

    private suspend fun pollUntilAnswering(): Boolean {
        // Give the Node server time to start listening on port 8799.
        // The process spawns immediately but server.listen() fires ~3s later on Android.
        delay(4000)
        val deadline = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < deadline && !stopping) {
            // Increased timeout from 800ms to 3000ms for Android cold start
            val response = http("GET", URL("$BASE_URL/api/health"), timeoutMs = 3000)
            if (response != null) {
                NodeState.update(healthJson = "GET /api/health -> ${response.status} ${response.body.take(200)}")
                return true
            }
            delay(300)
        }
        if (!stopping && NodeState.status.value.phase != NodeState.Phase.Failed) {
            NodeState.update(NodeState.Phase.Failed, detail = "no response from the server within 60 s")
            postNotification(getString(R.string.notif_failed), withStop = false, withResume = true)
        }
        return false
    }

    private suspend fun waitEnvironment(): Boolean {
        val deadline = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < deadline && !stopping) {
            val response = http("GET", URL("$BASE_URL/.well-known/openmausbot/environment"), timeoutMs = 2_000)
            if (response != null && response.status == 200 && response.body.contains("environmentId")) {
                NodeState.update(healthJson = "environment ${response.body.take(240)}")
                return true
            }
            delay(300)
        }
        return false
    }

    private var pairingAttempts = 0

    private fun pairWebView() {
        scope.launch {
            // Each attempt mints a session when the cookie store refuses the one it gets, so an
            // unattended retry loop would fill the sessions list. Few tries, then let the person pair.
            if (pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
                NodeState.update(detail = "this browser still has no session; pair it from Settings -> Remote access")
                return@launch
            }
            pairingAttempts++
            NodeState.update(detail = "pairing WebView")
            val existing = currentCookie()
            if (existing != null && verifySession(existing)) {
                NodeState.update(paired = true, detail = "session restored")
                return@launch
            }
            // The first boot after a reinstall can reach this before the server accepts pairings, and a
            // failed mint used to leave the page unauthenticated until the next restart.
            if (!mintAndStoreSession()) {
                repeat(4) { attempt ->
                    delay(1_500L * (attempt + 1))
                    if (mintAndStoreSession()) return@launch
                }
            }
            // The page was served before the cookie existed, so it is still the pairing screen: the
            // Activity reloads it once `paired` changes, and this is what changes it for a page that
            // was already attached.
            NodeState.update(paired = true, detail = "WebView session paired")
        }
    }

    /** Mints a pairing code on this server and keeps the session cookie it answers with. */
    private suspend fun mintAndStoreSession(): Boolean {
        val mint = http(
            "POST",
            URL("$BASE_URL/api/auth/pairing"),
            body = json("label" to CODE_LABEL),
            timeoutMs = 8_000,
        )
        if (mint == null || mint.status != 200) {
            NodeState.update(detail = "pairing mint failed: ${mint?.status ?: "no response"} ${mint?.body?.take(200) ?: ""}")
            return false
        }
        val code = extractJsonString(mint.body, "code")
        if (code == null) {
            NodeState.update(detail = "pairing body missing code: ${mint.body.take(200)}")
            return false
        }
        val body = normalizeExistingCode(code)
        val pair = http(
            "POST",
            URL("$BASE_URL/api/auth/pair"),
            body = json("code" to body, "label" to "Android WebView", "cookie" to true, "attemptId" to UUID.randomUUID().toString()),
            timeoutMs = 8_000,
        )
        if (pair == null || pair.status != 200) {
            NodeState.update(detail = "pair failed: ${pair?.status ?: "no response"} ${pair?.body?.take(200) ?: ""}")
            return false
        }
        val cookies = pair.setCookies
        if (cookies.isEmpty()) {
            NodeState.update(detail = "pair success without set-cookie: ${pair.body.take(200)}")
            return false
        }
        val stored = withContext(Dispatchers.Main) {
            val manager = CookieManager.getInstance()
            for (cookie in cookies) manager.setCookie("$BASE_URL/", cookie.trim())
            manager.flush()
            manager.getCookie(BASE_URL)
        }
        if (stored == null || !verifySession(stored)) {
            NodeState.update(detail = "cookie injection or session verify failed")
            return false
        }
        NodeState.update(paired = true, detail = "WebView session paired")
        return true
    }    private suspend fun currentCookie(): String? = withContext(Dispatchers.Main) {
        runCatching { CookieManager.getInstance().getCookie(BASE_URL) }.getOrNull()
    }

    private suspend fun verifySession(cookieHeader: String): Boolean {
        val response = http("GET", URL("$BASE_URL/api/auth/session"), headers = mapOf("Cookie" to cookieHeader), timeoutMs = 4_000)
        return response != null && response.status == 200 && response.body.contains("\"kind\"")
    }

    /** The server hashes codes after normalization (strips non-word chars, folds 0→O and 1→I
     * unless the string already is a credential), so the plain alnum form is interchangeable. */
    private fun normalizeExistingCode(code: String): String = code.uppercase().replace("-", "")

    private fun extractJsonString(body: String, key: String): String? {
        val needle = "\"$key\""
        val keyIndex = body.indexOf(needle)
        if (keyIndex < 0) return null
        val colon = body.indexOf(':', keyIndex + needle.length)
        if (colon < 0) return null
        var index = colon + 1
        while (index < body.length && body[index].isWhitespace()) index++
        if (index >= body.length || body[index] != '"') return null
        val end = body.indexOf('"', index + 1)
        return if (end < 0) null else body.substring(index + 1, end)
    }

    private fun json(vararg pairs: Pair<String, Any?>): String = pairs.joinToString(
        prefix = "{",
        postfix = "}",
        separator = ",",
    ) { (key, value) ->
        "\"" + key + "\":" + when (value) {
            is Boolean -> value.toString()
            is Number -> value.toString()
            else -> "\"" + (value as String?)?.replace("\\", "\\\\")?.replace("\"", "\\\"") + "\""
        }
    }

    private fun stopNode() {
        val process = nodeProcess
        nodeProcess = null
        if (process != null && process.isAlive) {
            try {
                process.destroy()
            } catch (_: Exception) {
            }
            val reaper = Thread {
                try {
                    if (!process.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) {
                        process.destroyForcibly()
                    }
                } catch (_: InterruptedException) {
                    process.destroyForcibly()
                }
            }
            reaper.isDaemon = true
            reaper.start()
        }
    }

    private fun startAsForeground() {
        val notification = buildNotification(
            NodeState.status.value.detail.ifEmpty { getString(R.string.notif_starting) },
        )
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(text: String, withStop: Boolean = true, withResume: Boolean = false): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_omb)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .apply {
                if (withStop) {
                    addAction(
                        0,
                        getString(R.string.notif_stop),
                        PendingIntent.getService(
                            this@NodeHostService,
                            1,
                            Intent(this@NodeHostService, NodeHostService::class.java).setAction(ACTION_STOP),
                            PendingIntent.FLAG_IMMUTABLE,
                        ),
                    )
                }
                if (withResume) {
                    addAction(
                        0,
                        getString(R.string.notif_resume),
                        PendingIntent.getService(
                            this@NodeHostService,
                            2,
                            Intent(this@NodeHostService, NodeHostService::class.java),
                            PendingIntent.FLAG_IMMUTABLE,
                        ),
                    )
                }
            }
            .build()
    }

    private fun postNotification(text: String, withStop: Boolean = true, withResume: Boolean = false) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text, withStop, withResume))
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private data class RawResponse(val status: Int, val body: String, val setCookies: List<String>)

    private fun http(
        method: String,
        url: URL,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
        timeoutMs: Int,
    ): RawResponse? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                requestMethod = method
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "OpenMausTestApp/1.0")
                for ((name, value) in headers) setRequestProperty(name, value)
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Content-Length", body.toByteArray(Charsets.UTF_8).size.toString())
                }
            }
            if (body != null) {
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..399) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val cookies = connection.headerFields.entries
                .filter { it.key != null && it.key.equals("set-cookie", ignoreCase = true) }
                .flatMap { it.value }
            RawResponse(status, text, cookies)
        } catch (e: IOException) {
            Log.w(TAG, "http $method ${url} failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        const val ACTION_STOP = "com.openmausbot.test.STOP"

        /** The live service, so an Activity can ask it to pair this WebView again. */
        private var instance: NodeHostService? = null

        /** Asks the live service to pair this WebView again, which a page with no session needs. */
        fun requestPairing() {
            instance?.pairWebView()
        }

        /** The pairing label the code-hint / sessions list shows a mint slot again quickly. */
        const val CODE_LABEL = "Windows-PC-DE2F"
        private const val CHANNEL_ID = "omb-test"
        private const val NOTIFICATION_ID = 42
        private const val OMB_ASSET_DIR = "omb"
        private const val INSTALL_DIR = "omb-installed"
        private const val SERVER_DIR = "server"
        private const val SERVER_ENTRY = "index.js"
        private const val UI_DIR = "ui"
        /** Assets.list() can answer empty for a folder this large, so the sprites are named instead. */
        private val POKEMON_SPRITE_NAMES = arrayOf("1.png", "2.png", "3.png", "4.png", "5.png", "6.png", "7.png", "8.png", "9.png", "10.png", "11.png", "12.png", "13.png", "14.png", "15.png", "16.png", "17.png", "18.png", "19.png", "20.png", "21.png", "22.png", "23.png", "24.png", "25.png", "26.png", "27.png", "28.png", "29.png", "30.png", "31.png", "32.png", "33.png", "34.png", "35.png", "36.png", "37.png", "38.png", "39.png", "40.png", "41.png", "42.png", "43.png", "44.png", "45.png", "46.png", "47.png", "48.png", "49.png", "50.png", "51.png", "52.png", "53.png", "54.png", "55.png", "56.png", "57.png", "58.png", "59.png", "60.png", "61.png", "62.png", "63.png", "64.png", "65.png", "66.png", "67.png", "68.png", "69.png", "70.png", "71.png", "72.png", "73.png", "74.png", "75.png", "76.png", "77.png", "78.png", "79.png", "80.png", "81.png", "82.png", "83.png", "84.png", "85.png", "86.png", "87.png", "88.png", "89.png", "90.png", "91.png", "92.png", "93.png", "94.png", "95.png", "96.png", "97.png", "98.png", "99.png", "100.png", "101.png", "102.png", "103.png", "104.png", "105.png", "106.png", "107.png", "108.png", "109.png", "110.png", "111.png", "112.png", "113.png", "114.png", "115.png", "116.png", "117.png", "118.png", "119.png", "120.png", "121.png", "122.png", "123.png", "124.png", "125.png", "126.png", "127.png", "128.png", "129.png", "130.png", "131.png", "132.png", "133.png", "134.png", "135.png", "136.png", "137.png", "138.png", "139.png", "140.png", "141.png", "142.png", "143.png", "144.png", "145.png", "146.png", "147.png", "148.png", "149.png", "150.png", "151.png")
        private const val NODE_LIB = "libnodeexec.so"
        const val BASE_URL = "http://127.0.0.1:8799"
        /** Minting a session the WebView then refuses would repeat forever; a person pairs by hand after this. */
        private const val MAX_PAIRING_ATTEMPTS = 3
        private const val SKILLS_DIR = "skills"
        private const val LINUX_DIR = "linux"

        /** Engine CLIs staged beside proot in files/linux, where OMB_EXTRA_PATH points. Each needs
         *  its exec bit restored after extraction, or the server reports it as not executable. */
        private val ENGINE_BINARIES = listOf("opencode")
        private const val USER_DATA_DIR = "user-data"
        private const val WORKSPACE_DIR = "workspace"
         private const val DATA_DIR_NAME = "data"
        private const val LOG_CAP_BYTES = 5_000_000L
        private const val LOG_TAIL_CHARS = 2048
        private const val MAX_RESTARTS = 3
        /** Mirrors CRASH_BACKOFF_MS in server/restart.ts: a crash in a row waits longer each time. */
        private val RESTART_BACKOFF_MS = longArrayOf(1_000, 2_000, 5_000)
        /** Mirrors CRASH_EXIT_CODE and the shell's 128 + signal: a server that asked for this, or that the system killed. */
        private const val CRASH_EXIT_CODE = 70
        private val KILLED_CODES = setOf(134, 137, 139)
        private const val TAG = "NodeHostService"
    }
}
