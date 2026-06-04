import groovy.json.JsonSlurper
import java.io.File
import java.util.Properties

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

val keepRustDebugSymbols = providers
    .gradleProperty("flowcloudai.keepRustDebugSymbols")
    .map { it.toBoolean() }
    .orElse(false)

data class RustlsPlatformVerifierAndroidArtifact(
    val mavenRepository: String,
    val version: String,
)

fun findRustlsPlatformVerifierAndroidArtifact(): RustlsPlatformVerifierAndroidArtifact {
    val dependencyText = providers.exec {
        workingDir = file("../../..")
        commandLine(
            "cargo",
            "metadata",
            "--format-version",
            "1",
            "--filter-platform",
            "aarch64-linux-android",
            "--locked",
            "--manifest-path",
            file("../../../Cargo.toml").absolutePath,
        )
    }.standardOutput.asText.get()

    val dependencyJson = JsonSlurper().parseText(dependencyText) as Map<*, *>
    val packages = dependencyJson["packages"] as List<*>
    val verifierPackage = packages
        .filterIsInstance<Map<*, *>>()
        .firstOrNull { it["name"] == "rustls-platform-verifier-android" }
        ?: error("未找到 rustls-platform-verifier-android 包，请先执行 cargo metadata 检查依赖解析")
    val manifestPath = verifierPackage["manifest_path"]?.toString()
        ?: error("rustls-platform-verifier-android 缺少 manifest_path")
    val version = verifierPackage["version"]?.toString()
        ?: error("rustls-platform-verifier-android 缺少 version")

    return RustlsPlatformVerifierAndroidArtifact(
        mavenRepository = File(File(manifestPath).parentFile, "maven").path,
        version = version,
    )
}

val rustlsPlatformVerifierAndroid = findRustlsPlatformVerifierAndroidArtifact()

repositories {
    maven {
        url = uri(rustlsPlatformVerifierAndroid.mavenRepository)
        metadataSources {
            mavenPom()
            artifact()
        }
    }
}

android {
    compileSdk = 36
    namespace = "cn.flowcloudai.www"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "cn.flowcloudai.www"
        // cpal 在 Android 上走 AAudio，要求 API 26 及以上。
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = keepRustDebugSymbols.get()
            isMinifyEnabled = false
            if (keepRustDebugSymbols.get()) {
                // 默认不打包 Rust 调试符号，避免 x86_64 debug APK 膨胀到 GB 级。
                packaging {
                    jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                    jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                    jniLibs.keepDebugSymbols.add("*/x86/*.so")
                    jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
                }
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(file("../../../rustls-platform-verifier.pro"))
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("rustls:rustls-platform-verifier:${rustlsPlatformVerifierAndroid.version}")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
