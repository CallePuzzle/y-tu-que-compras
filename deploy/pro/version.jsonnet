// Versión desplegada en pro (producción de la app). La CI la sobreescribe en
// cada release (job bump-pro de .github/workflows/release.yml) y Argo CD
// (autoSync) la aplica.
// Este valor es el placeholder inicial: no corresponde a ninguna imagen de
// ghcr.io (la primera release real generará v0.0.1).
{
  version: 'v0.0.0',
}
