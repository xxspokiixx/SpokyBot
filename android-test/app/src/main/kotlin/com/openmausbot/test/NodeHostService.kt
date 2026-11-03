package com.openmausbot.test

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
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
import java.io.IOException
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
    private var watcher: kotlinx.coroutines.Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
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
        stopping = true
        stopNode()
        scope.cancel()
        super.onDestroy()
    }

    private fun runBoot() {
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
            watcher?.cancel()
            watcher = null
            Log.d(TAG, "runBoot: extracting if needed")
            NodeState.update(NodeState.Phase.Extracting, detail = getString(R.string.status_extracting))
            val installError = extractIfNeeded()
            Log.d(TAG, "runBoot: extractIfNeeded returned: ${installError ?: "null"}")
            if (installError != null) {
                NodeState.update(NodeState.Phase.BundleMissing, detail = installError)
                postNotification(getString(R.string.notif_bundle_missing), withStop = false, withResume = true)
                return
            }
            val node = File(applicationInfo.nativeLibraryDir, NODE_LIB)
            Log.d(TAG, "runBoot: node exists=${node.exists()} path=${node.absolutePath}")
            if (!node.exists()) {
                NodeState.update(NodeState.Phase.RuntimeMissing, detail = getString(R.string.status_runtime_missing))
                postNotification(getString(R.string.notif_runtime_missing), withStop = false, withResume = true)
                return
            }
            Log.d(TAG, "runBoot: cleaning stale leases")
            cleanupStaleLeases()
            Log.d(TAG, "runBoot: killing port hoggers")
            killPortHoggers()
            // Give the OS time to release the port after killing hoggers
            Thread.sleep(500)
            Log.d(TAG, "runBoot: ensuring server config")
            ensureServerConfig(node.absolutePath)
            Log.d(TAG, "runBoot: ensuring local computer")
            ensureLocalComputer(node.absolutePath)
            Log.d(TAG, "runBoot: starting node")
            startNode(node.absolutePath)
            Log.d(TAG, "runBoot: polling server")
            pollServer()
        } finally {
            booting.set(false)
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

    /** Stages the phone's "this computer" (see android-test/linux/): a proot'ed
     * Alpine rootfs plus the MCP server the harness gate launches for a bot that
     * picks "this computer" as its working destination. */
    private fun ensureLocalComputer(nodePath: String) {
        val linux = File(filesDir, LINUX_DIR)
        val mcp = File(linux, "android-local-computer.mjs")
        try {
            val version = assets.open("$OMB_ASSET_DIR/VERSION").bufferedReader().use { it.readText().trim() }
            val stamp = File(linux, "STAMP")
            val stampText = runCatching { stamp.readText().trim() }.getOrDefault("")
            if (!mcp.exists() || stampText != version) {
                linux.deleteRecursively()
                linux.mkdirs()
                copyAssetDir(assets, "$OMB_ASSET_DIR/linux", linux)
                val rootfs = File(linux, "rootfs")
                rootfs.mkdirs()
                // aapt decompresses *.gz assets, so the tarball ships as rootfs.blob —
                // still a gzip stream either way; plain tars arrive from older builds.
                val tarball = File(linux, "rootfs.blob").takeIf { it.exists() }
                    ?: File(linux, "rootfs.tar.gz").takeIf { it.exists() }
                    ?: File(linux, "rootfs.tar")
                val tarFlags = if (tarball.name == "rootfs.blob" || tarball.name.endsWith(".gz")) listOf("-xzf") else listOf("-xf")
                val tar = ProcessBuilder(listOf("/system/bin/tar") + tarFlags + listOf(tarball.absolutePath, "-C", rootfs.absolutePath))
                    .redirectErrorStream(true)
                    .start()
                val tarOutput = tar.inputStream.bufferedReader().use { it.readText() }
                if (tar.waitFor() != 0) {
                    NodeState.update(detail = "linux environment extraction failed: ${tarOutput.takeLast(300)}")
                    return
                }
                tarball.delete()
                // copyAssetDir streams bytes only: every exec-able file in the
                // payload needs its mode restored, or execve answers EACCES.
                File(linux, "proot").setExecutable(true, false)
                File(linux, "loader").setExecutable(true, false)
                File(linux, "omb-guest-chromium").setExecutable(true, false)
                stamp.writeText(version)
            }
            val workspace = File(filesDir, WORKSPACE_DIR).apply { mkdirs() }
            val dataDir = File(filesDir, DATA_DIR_NAME).apply { mkdirs() }
            File(linux, "tmp").apply { mkdirs() }
            writeGuestResolvConf(File(linux, "rootfs"))
            val userData = File(filesDir, USER_DATA_DIR).apply { mkdirs() }
            val descriptor = File(userData, "cua-connection.json")
            val mcpEnv = mapOf(
                "OMB_ANDROID_LINUX_DIR" to linux.absolutePath,
                "OMB_ANDROID_ROOTFS" to File(linux, "rootfs").absolutePath,
                "OMB_ANDROID_WORKSPACE" to workspace.absolutePath,
                "OMB_ANDROID_DATA_DIR" to dataDir.absolutePath,
                "OMB_EXTRA_PATH" to File(linux, "bin").absolutePath,
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
                        val output = proc.inputStream.bufferedReader().use { it.readText() }
                        proc.waitFor()
                        "[$label] exit=${proc.exitValue()}: ${output.trim().take(400)}\n"
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
        } catch (e: IOException) {
            NodeState.update(detail = "linux environment setup failed: ${e.message}")
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
        return null
    }

    private fun copyAssetDir(assets: android.content.res.AssetManager, from: String, to: File) {
        to.mkdirs()
        for (name in assets.list(from) ?: emptyArray()) {
            val child = "$from/$name"
            if ((assets.list(child) ?: emptyArray()).isNotEmpty()) {
                copyAssetDir(assets, child, File(to, name))
            } else {
                assets.open(child).use { input ->
                    File(to, name).outputStream().use { output -> input.copyTo(output) }
                }
            }
        }
    }

    private fun startNode(nodePath: String) {
        val home = File(filesDir, "home").apply { mkdirs() }
        File(filesDir, "tmp").mkdirs()
        val install = File(filesDir, INSTALL_DIR)
        val serverDir = File(install, SERVER_DIR)
        val entry = File(serverDir, SERVER_ENTRY)
        if (!entry.exists()) {
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
        val process = ProcessBuilder(nodePath, entry.absolutePath)
            .directory(serverDir)
            .redirectErrorStream(true)
            .apply {
                environment().clear()
                environment().putAll(processEnv(home, install))
            }
            .start()
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
        put("OMB_ANDROID_LINUX_DIR", File(filesDir, LINUX_DIR).absolutePath)
put("OMB_ANDROID_DATA_DIR", File(filesDir, DATA_DIR_NAME).absolutePath)
put("OMB_EXTRA_PATH", File(File(filesDir, LINUX_DIR), "bin").absolutePath)
        put("LD_LIBRARY_PATH", File(filesDir, LINUX_DIR).absolutePath)
        // The proot chains the server itself spawns (the OpenCode engine) need
        // the same loader contract the MCP scripts set explicitly.
        put("PROOT_TMP_DIR", File(File(filesDir, LINUX_DIR), "tmp").absolutePath)
        put("PROOT_NO_SECCOMP", "1")
        put("PROOT_ASSUME_MEMFD_UNSUPPORTED", "1")
        put("PROOT_LOADER", File(File(filesDir, LINUX_DIR), "loader").absolutePath)
        openCodeApiKey?.let { put("OPENCODE_API_KEY", it) }
        // The phone's browser: the guest's chromium, reached through the
        // omb-guest-chromium wrapper, and Chrome's own sandbox off (the guest
        // runs under proot, without user namespaces).
        put("OMB_CHROME_PATH", File(File(filesDir, LINUX_DIR), "omb-guest-chromium").absolutePath)
        put("OMB_BROWSER_SANDBOX", "0")
        // Android standalone: trust local WebView without pairing
        put("OMB_ANDROID_STANDALONE", "1")
        val skills = File(install, SKILLS_DIR)
        if (skills.isDirectory) put("OMB_SKILLS_DIR", skills.absolutePath)
    }

    private fun tailProcess(process: Process, logFile: File) {
        try {
            process.inputStream.bufferedReader().forEachLine { line ->
                runCatching {
                    if (logFile.length() > LOG_CAP_BYTES) logFile.delete()
                    logFile.appendText(line + "\n")
                }
                NodeState.status.update { it.copy(logTail = tail(it.logTail, line)) }
            }
        } catch (_: IOException) {
        }
        val exit = try {
            process.waitFor()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return
        }
        if (stopping) return
        val phase = NodeState.status.value.phase
        when {
            phase == NodeState.Phase.Failed || phase == NodeState.Phase.Stopped || phase == NodeState.Phase.Idle -> return
            phase == NodeState.Phase.Ready -> {
                NodeState.update(NodeState.Phase.Stopped, detail = "node exited (code $exit)")
                postNotification(getString(R.string.notif_stopped), withStop = false, withResume = true)
            }
            restarts < MAX_RESTARTS -> {
                restarts++
                NodeState.status.update { it.copy(detail = "node exited (code $exit); restarting") }
                runBoot()
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
    private fun pollServer() {
        scope.launch {
            if (!pollUntilAnswering()) return@launch
            NodeState.update(NodeState.Phase.Running, detail = "port answering")
            if (!waitEnvironment()) {
                NodeState.update(
                    NodeState.Phase.Failed,
                    detail = "no 200 with environmentId from /.well-known/openmausbot/environment within 30 s",
                )
                postNotification(getString(R.string.notif_failed), withStop = false, withResume = true)
                return@launch
            }
            restarts = 0
            NodeState.update(NodeState.Phase.Ready, detail = "harness ready")
            postNotification(getString(R.string.notif_ready))
            pairWebView()
        }
    }

    private suspend fun pollUntilAnswering(): Boolean {
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

    private fun watchHealthForever() {
        watcher?.cancel()
        watcher = scope.launch {
            while (!stopping) {
                delay(2_000)
                val response = http("GET", URL("$BASE_URL/api/health"), timeoutMs = 1_500)
                if (response != null) {
                    NodeState.status.update {
                        it.copy(healthJson = "GET /api/health -> ${response.status} ${response.body.take(200)}")
                    }
                }
            }
        }
    }

    private fun pairWebView() {
        scope.launch {
            NodeState.update(detail = "pairing WebView")
            val existing = currentCookie()
            if (existing != null && verifySession(existing)) {
                NodeState.update(paired = true, detail = "session restored")
                return@launch
            }
            val mint = http(
                "POST",
                URL("$BASE_URL/api/auth/pairing"),
                body = json("label" to CODE_LABEL),
                timeoutMs = 8_000,
            )
            if (mint == null || mint.status != 200) {
                NodeState.update(detail = "pairing mint failed: ${mint?.status ?: "no response"} ${mint?.body?.take(200) ?: ""}")
                return@launch
            }
            val code = extractJsonString(mint.body, "code")
            if (code == null) {
                NodeState.update(detail = "pairing body missing code: ${mint.body.take(200)}")
                return@launch
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
                return@launch
            }
            val cookies = pair.setCookies
            if (cookies.isEmpty()) {
                NodeState.update(detail = "pair success without set-cookie: ${pair.body.take(200)}")
                return@launch
            }
            val stored = withContext(Dispatchers.Main) {
                val manager = CookieManager.getInstance()
                for (cookie in cookies) manager.setCookie("$BASE_URL/", cookie.trim())
                manager.flush()
                manager.getCookie(BASE_URL)
            }
            if (stored == null || !verifySession(stored)) {
                NodeState.update(detail = "cookie injection or session verify failed")
                return@launch
            }
            NodeState.update(paired = true, detail = "WebView session paired")
        }
    }

    private suspend fun currentCookie(): String? = withContext(Dispatchers.Main) {
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
            null
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        const val ACTION_STOP = "com.openmausbot.test.STOP"
        /** The pairing label the code-hint / sessions list shows a mint slot again quickly. */
        const val CODE_LABEL = "Windows-PC-DE2F"
        private const val CHANNEL_ID = "omb-test"
        private const val NOTIFICATION_ID = 42
        private const val OMB_ASSET_DIR = "omb"
        private const val INSTALL_DIR = "omb-installed"
        private const val SERVER_DIR = "server"
        private const val SERVER_ENTRY = "index.js"
        private const val UI_DIR = "ui"
        private const val NODE_LIB = "libnodeexec.so"
        const val BASE_URL = "http://127.0.0.1:8799"
        private const val SKILLS_DIR = "skills"
        private const val LINUX_DIR = "linux"
        private const val USER_DATA_DIR = "user-data"
        private const val WORKSPACE_DIR = "workspace"
         private const val DATA_DIR_NAME = "data"
        private const val LOG_CAP_BYTES = 5_000_000L
        private const val LOG_TAIL_CHARS = 2048
        private const val MAX_RESTARTS = 3
        private const val TAG = "NodeHostService"
    }
}
