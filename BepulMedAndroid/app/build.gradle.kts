// Сборка в Android Studio. Без внешних библиотек: только Android SDK.
// Интерфейс лежит в src/main/assets/www (копия bepulmed/web/dist, обновляется скриптом build.sh).
plugins {
    id("com.android.application")
}

android {
    namespace = "uz.bepulmed.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "uz.bepulmed.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 32
        versionName = "2.12"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
