plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseVersion = providers.environmentVariable("XBOND_VERSION").orNull
val releaseBuild = providers.environmentVariable("XBOND_BUILD_NUMBER").orNull
val releaseKey = providers.environmentVariable("XBOND_RELEASE_PUBLIC_KEY").orNull
if (releaseVersion != null || releaseBuild != null || releaseKey != null) {
    require(releaseVersion?.matches(Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) == true)
    require((releaseBuild?.toIntOrNull() ?: 0) in 1..2_100_000_000)
    require(releaseKey?.matches(Regex("[A-Za-z0-9+/]{43}=")) == true)
}

// The shared web UI (packages/client-ui, built by `pnpm build` into the repo
// dist/) ships inside the APK; MainActivity extracts it into the data dir
// where the in-process LocalAPI serves it.
val copyWebDist = tasks.register<Copy>("copyWebDist") {
    from("../../../../dist")
    into("src/main/assets/web")
    doLast {
        // Marker for MainActivity's extraction check: re-extract only when
        // the packaged dist actually changed (path+size fingerprint).
        val distDir = file("../../../../dist")
        val files = fileTree(distDir).files.sortedBy { it.relativeTo(distDir).path }
        val fingerprint = files.joinToString("|") { it.relativeTo(distDir).path + ":" + it.length() }
        file("src/main/assets/web/xbond-dist-version.txt").writeText(fingerprint.hashCode().toString())
    }
}
tasks.named("preBuild") { dependsOn(copyWebDist) }

android {
    namespace = "net.xbond.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.xbond.app"
        minSdk = 24
        targetSdk = 36
        versionCode = releaseBuild?.toInt() ?: 1
        versionName = releaseVersion ?: "0.1.0"
        buildConfigField("String", "RELEASE_PUBLIC_KEY", "\"${releaseKey.orEmpty()}\"")
    }

    buildFeatures {
        buildConfig = true
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
