plugins {
    id("com.android.application")
}

android {
    namespace = "com.openmausbot.test"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.openmausbot.test"
        minSdk = 26
        // targetSdk 28 on purpose: 29+ domains deny execve() of files in the app's
        // own data directory, which the proot'ed Linux environment (binaries inside
        // files/linux) needs — the Termux precedent. Test-only, never store-distributed.
        targetSdk = 28
        versionCode = 4131066
        versionName = "0.4131.66"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    packaging {
        jniLibs {
            // libnodeexec.so is an ELF executable the service spawn()s, not a
            // dlopen target: modern Android keeps unextracted libs inside the
            // APK when useLegacyPackaging=false, and nativeLibraryDir would
            // then not contain the file.
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
