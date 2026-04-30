plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    implementation(projects.common)
    compileOnly(libs.ignition.common)
    compileOnly(libs.ignition.gateway.api)
    compileOnly(libs.ignition.perspective.gateway)
    compileOnly(libs.ignition.perspective.common)
    compileOnly(libs.ia.gson)
}

tasks.named<ProcessResources>("processResources") {
    from(projectDir.resolve("hmi-state-style-maps.json")) {
        into("")
    }
}
