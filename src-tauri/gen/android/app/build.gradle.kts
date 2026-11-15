import java.util.Base64
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release identity contract (docs/specs/mobile-android.md): the CI android
// job sets XBOND_VERSION / XBOND_BUILD_NUMBER and release-android.ts verifies
// the badging afterwards. Local builds fall back to tauri.properties.
val releaseVersion = providers.environmentVariable("XBOND_VERSION").orNull
val releaseBuild = providers.environmentVariable("XBOND_BUILD_NUMBER").orNull

fun signingEnv(name: String): String? =
    providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() }
        ?: System.getenv(name)?.takeIf { it.isNotBlank() }

val releaseKeystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val releaseStorePassword =
    releaseKeystoreProperties.getProperty("storePassword") ?: signingEnv("ANDROID_STORE_PASSWORD")
val releaseKeyAlias =
    releaseKeystoreProperties.getProperty("keyAlias") ?: signingEnv("ANDROID_KEY_ALIAS")
val releaseKeyPassword =
    releaseKeystoreProperties.getProperty("keyPassword")
        ?: signingEnv("ANDROID_KEY_PASSWORD")
        ?: releaseStorePassword
val releaseStoreFileProp =
    releaseKeystoreProperties.getProperty("storeFile") ?: signingEnv("ANDROID_KEYSTORE")
val releaseKeystoreBase64 = signingEnv("ANDROID_KEYSTORE_BASE64")
val hasReleaseSigningCreds =
    !releaseStorePassword.isNullOrBlank() && !releaseKeyAlias.isNullOrBlank()
val releaseKeystoreFile: java.io.File? = if (hasReleaseSigningCreds) {
    val explicit = releaseStoreFileProp?.takeIf { it.isNotBlank() }?.let { rootProject.file(it) }
    when {
        explicit != null && explicit.exists() -> explicit
        !releaseKeystoreBase64.isNullOrBlank() -> {
            val file = layout.buildDirectory.file("signing/xbond-release.keystore").get().asFile
            file.parentFile.mkdirs()
            file.writeBytes(Base64.getDecoder().decode(releaseKeystoreBase64.trim()))
            file
        }

        else -> null
    }
} else {
    null
}

android {
    compileSdk = 37
    namespace = "net.xbond.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "net.xbond.app"
        minSdk = 24
        targetSdk = 37
        versionCode = releaseBuild?.toInt() ?: tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = releaseVersion ?: tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseKeystoreFile != null) {
            create("releaseShared") {
                storeFile = releaseKeystoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            signingConfigs.findByName("releaseShared")?.let { signingConfig = it }
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
