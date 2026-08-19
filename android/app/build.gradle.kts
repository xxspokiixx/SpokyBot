plugins {
    id("com.android.application")
    kotlin("plugin.compose")
    kotlin("plugin.serialization")
}

android {
    namespace = "com.openmausbot.companion"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.openmausbot.companion"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
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

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core"))

    val composeBom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    // Part of Compose, version-managed by the BOM above: the ~40 icons in the
    // core set cover every glyph these screens draw. The `-extended` artifact is
    // deliberately not used — it is thousands of vectors for a handful of uses.
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-process:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.security:security-crypto:1.1.0-alpha07")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.core:core-ktx:1.17.0")

    // Pairing QR scanner. CameraX gives the preview and frame pipeline; ML Kit's
    // *bundled* barcode model reads them. Bundled rather than the Play-services
    // variants (`play-services-code-scanner` / unbundled ML Kit) because pairing
    // happens on a LAN, often on a phone whose Google Play services cannot be
    // assumed — a scanner that needs a module download at the moment a two-minute
    // pairing window is open is a scanner that fails when it matters. It also
    // keeps the confirm-before-pair step in this process, where the app can show
    // the computer's name and address before anything is redeemed (§6).
    // Cost, measured on this APK: libbarhopper_v3.so is 4.95 MB per ABI plus
    // 0.88 MB of model assets — call it 6 MB on a device, since an app bundle
    // ships one ABI. That is the price of scanning without Play services; the
    // lever if it ever matters is `play-services-mlkit-barcode-scanning`, which
    // is a few hundred KB and downloads the model on demand. Scanning is
    // restricted to FORMAT_QR_CODE.
    implementation("androidx.camera:camera-core:1.5.0")
    implementation("androidx.camera:camera-camera2:1.5.0")
    implementation("androidx.camera:camera-lifecycle:1.5.0")
    implementation("androidx.camera:camera-view:1.5.0")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.2.21")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("junit:junit:4.13.2")
}
