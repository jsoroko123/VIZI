import io.ia.sdk.gradle.modl.task.Deploy
import io.ia.sdk.gradle.modl.task.SignModule
import java.util.Properties

plugins {
    base
    id("io.ia.sdk.modl") version("0.1.1")
}

allprojects {
version = "0.1.138"
    group = "com.mesora.perspective.drawing"
}

val appDir = rootProject.projectDir.resolve("../../app").canonicalFile
val webBuildScript = rootProject.file("web/build.mjs")
val webBundleFileName = "drawingtool-${project.version}.js"
val webOutputFile = rootProject.file("gateway/src/main/resources/mounted/js/$webBundleFileName")
val svgLibraryOutputDir = rootProject.file("gateway/src/main/resources/mounted/svg-library")

val signPropsFile = rootProject.file("sign.props")
val signProps = Properties().apply {
    if (signPropsFile.exists()) {
        signPropsFile.inputStream().use(::load)
    }
}

fun signProp(name: String): String = signProps.getProperty(name)?.trim().orEmpty()

val signingMissingProps = listOf("key.file", "key.pass", "cert.file", "cert.alias", "cert.pass")
    .filter { signPropsFile.exists() && signProp(it).isBlank() }

val signingKeystoreFile = signProp("key.file").takeIf(String::isNotBlank)?.let(rootProject::file)
val signingCertificateFile = signProp("cert.file").takeIf(String::isNotBlank)?.let(rootProject::file)

val signingMissingFiles = buildList {
    if (signPropsFile.exists() && signingMissingProps.isEmpty()) {
        if (signingKeystoreFile?.exists() != true) {
            add(signingKeystoreFile?.path ?: signProp("key.file"))
        }
        if (signingCertificateFile?.exists() != true) {
            add(signingCertificateFile?.path ?: signProp("cert.file"))
        }
    }
}

val signingConfigured = signPropsFile.exists() && signingMissingProps.isEmpty() && signingMissingFiles.isEmpty()

fun signingSetupError(): String = when {
    !signPropsFile.exists() ->
        "Signing is not configured. Create ${signPropsFile.absolutePath} from sign.props.example and point it at your .pfx and .p7b files."
    signingMissingProps.isNotEmpty() ->
        "Signing is missing required properties in ${signPropsFile.absolutePath}: ${signingMissingProps.joinToString(", ")}"
    signingMissingFiles.isNotEmpty() ->
        "Signing references files that do not exist: ${signingMissingFiles.joinToString(", ")}"
    else ->
        ""
}

ignitionModule {
    fileName.set("MesoraPerspectiveDrawingTool")

    name.set("MesoraPerspectiveDrawingTool")
    id.set("com.mesora.perspective.drawing")
    moduleVersion.set("${project.version}")
    moduleDescription.set("A Perspective custom component module for Vizi drawing documents.")
    requiredIgnitionVersion.set("8.3.0")
    requiredFrameworkVersion.set("8")
    freeModule.set(true)
    license.set("license.html")

    moduleDependencies.putAll(
        mapOf(
            "com.inductiveautomation.perspective" to "GD"
        )
    )

    projectScopes.putAll(
        mapOf(
            ":gateway" to "G",
            ":common" to "DG",
            ":designer" to "D"
        )
    )

    hooks.putAll(
        mapOf(
            "com.mesora.perspective.drawing.gateway.MesoraPerspectiveDrawingGatewayHook" to "G",
            "com.mesora.perspective.drawing.designer.MesoraPerspectiveDrawingDesignerHook" to "D"
        )
    )

    skipModlSigning.set(!signingConfigured)
}

val buildWebBundle by tasks.registering(Exec::class) {
    group = "build"
    description = "Builds the React browser bundle for the Perspective drawing tool."

    inputs.dir(rootProject.file("web"))
    inputs.dir(appDir.resolve("src"))
    outputs.file(webOutputFile)
    outputs.dir(svgLibraryOutputDir)

    workingDir(rootProject.projectDir)
    commandLine("node", webBuildScript.absolutePath, webBundleFileName)

    doFirst {
        if (!webBuildScript.exists()) {
            throw GradleException(
                "Web build script was not found at ${webBuildScript.absolutePath}."
            )
        }
    }
}

project(":gateway") {
    tasks.matching { it.name == "processResources" }.configureEach {
        dependsOn(rootProject.tasks.named("buildWebBundle"))
    }
}

tasks.named<SignModule>("signModule") {
    skipSigning.set(!signingConfigured)

    if (signPropsFile.exists() && signingMissingProps.isEmpty()) {
        setKeystorePath(signProp("key.file"))
        setKeystorePw(signProp("key.pass"))
        setCertFilePath(signProp("cert.file"))
        setAlias(signProp("cert.alias"))
        setCertPw(signProp("cert.pass"))
    }
}

tasks.matching { it.name == "assembleModlStructure" }.configureEach {
    doFirst {
        delete(layout.buildDirectory.dir("moduleContent"))
        delete(layout.buildDirectory.dir("modl-unpack-check"))
        delete(layout.buildDirectory.file("MesoraPerspectiveDrawingTool.modl"))
        delete(layout.buildDirectory.file("MesoraPerspectiveDrawingTool.unsigned.modl"))
        delete(layout.buildDirectory.file("MesoraPerspectiveDrawingTool.zip"))
        delete(layout.buildDirectory.file("buildResult.json"))
    }
}

val deepClean by tasks.registering {
    dependsOn(allprojects.map { "${it.path}:clean" })
    description = "Executes clean tasks for all subprojects."
}

tasks.named("build") {
    mustRunAfter(deepClean)
}

val signingStatus by tasks.registering {
    group = "build"
    description = "Reports whether module signing is configured."
    doLast {
        if (signingConfigured) {
            println("Module signing is enabled.")
            println("Using signing properties from: ${signPropsFile.absolutePath}")
            println("Keystore: ${signingKeystoreFile?.absolutePath}")
            println("Certificate chain: ${signingCertificateFile?.absolutePath}")
        } else {
            println("Module signing is currently disabled.")
            println(signingSetupError())
        }
    }
}

val buildSigned by tasks.registering {
    group = "build"
    description = "Builds a signed module. Requires sign.props and referenced certificate files."
    if (!signingConfigured) {
        doFirst {
            throw GradleException(signingSetupError())
        }
    }
    dependsOn(deepClean)
    dependsOn("build")
}
