import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// RELEASE_PUBLIC_KEY feeds the self-hosted updater (AppUpdates): the pinned
// minisign public key of the release manifest, empty in dev builds.
val releaseKey = System.getenv("XBOND_RELEASE_PUBLIC_KEY") ?: ""

android {
    namespace = "net.xbond.app.xbond"
    compileSdk = 36

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        buildConfigField("String", "RELEASE_PUBLIC_KEY", "\"$releaseKey\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

dependencies {
    implementation(project(":tauri-android"))
    // gomobile binding (pnpm mobile:bind:android): TunnelService, PlatformBridge
    // and the release-signature verification used by AppUpdates.
    implementation(files("libs/xbond-mobile.aar"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
}
