package pe.mesagri.app;

/** Versión de la app y dirección del servidor en la nube (las escribe build.sh). */
final class BuildInfo {
    static final String VERSION = "1.1.0";
    /** Servidor de Mesagri (https://...). Vacío: solo la versión autónoma dentro del celular. */
    static final String SERVER = "https://mesagri.onrender.com";
    private BuildInfo() {}
}
