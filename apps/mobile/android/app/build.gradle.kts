plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The shared web UI (packages/client-ui, built by `pnpm build` into the repo
// dist/) ships inside the APK; MainActivity extracts it into the data dir
// where the in-process LocalAPI serves it.
val copyWebDist = tasks.register<Copy>("copyWebDist") {
    from("../../../../dist")
    into("src/main/assets/web")
}
tasks.named("preBuild") { dependsOn(copyWebDist) }

android {
    namespace = "net.xbond.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.xbond.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
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
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // gomobile dual-core binding — regenerate with `pnpm mobile:bind:android`.
    // Points at the bind output (../xbond-mobile.aar) directly: one file, no
    // copy step that can go stale.
    implementation(files("../xbond-mobile.aar"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
