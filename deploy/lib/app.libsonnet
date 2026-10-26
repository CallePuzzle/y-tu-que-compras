local k = import 'k.libsonnet';
local tk = import 'tk';
local ingress = k.networking.v1.ingress;
local _app = (import 'github.com/CallePuzzle/jsonnet-lib-manifests/app.libsonnet');
local _container = (import 'github.com/CallePuzzle/jsonnet-lib-manifests/container.libsonnet');
local _secret = (import 'github.com/CallePuzzle/jsonnet-lib-manifests/secret-stringData.libsonnet');

// App y-tu-que-compras (SvelteKit 2 + adapter-node) + su PostgreSQL en el
// clúster (CloudNativePG), patrón Zytera/auth. Orden de sync garantizado por
// las sync-waves de Argo CD:
//   10 secrets → 15 Cluster CNPG → 20 ScheduledBackup → 50 workload/svc/ingress.
// El init container `db-migrate` aplica las migraciones de Prisma dentro del
// pod, ya con la BD accesible, antes de arrancar el servidor.
{
  values:: {
    serverAlias: error 'serverAlias is required',
    pullPolicy: 'IfNotPresent',
    // Nombre del Cluster CNPG y de sus secrets (<name>-credentials,
    // <name>-backup-credentials).
    dbClusterName: 'ytqc-db',
    // Carpeta bajo s3://jilguedev-db-backups/. Debe ser única por entorno: el
    // bucket es compartido y la carpeta final del barman store coincide con el
    // serverName.
    dbBackupPath: 'ytqc-db',
  },
  local secrets = (import 'secrets.json'),
  local container_values = {
    name: 'y-tu-que-compras',
    image: 'ghcr.io/callepuzzle/y-tu-que-compras',
    tag: (import 'version.jsonnet').version,
    pullSecret: [{ name: 'token-registry' }],
    pullPolicy: $.values.pullPolicy,
    namespace: tk.env.spec.namespace,
    labels: {
      owner: 'callepuzzle',
    },
    env: {
      NODE_ENV: 'production',
      // Servidor de adapter-node: bind a todas las interfaces y al puerto que
      // exponen Service/Ingress.
      HOST: '0.0.0.0',
      PORT: '8080',
      // URL pública fija: detrás del proxy (Cloudflare → Traefik) el pod ve
      // http y otro Host. Con ORIGIN, SvelteKit construye las URLs y valida el
      // CSRF de los form actions contra el origen público sin depender de
      // cabeceras reenviadas. better-auth, por su lado, confía en el origen de
      // BETTER_AUTH_URL (mismo valor), así que no hace falta trustedOrigins ni
      // PROTOCOL_HEADER/HOST_HEADER.
      ORIGIN: 'https://' + $.values.serverAlias,
      BETTER_AUTH_URL: 'https://' + $.values.serverAlias,
    },
    envFrom: [
      { secretRef: { name: 'y-tu-que-compras' } },
    ],
    // uid del usuario `nonroot` de la imagen runtime (distroless de bun, ver
    // Dockerfile).
    userId: 65532,
  },
  local initContainer = [
    (_container { values+: container_values {
       name: 'db-migrate',
       // Misma imagen (distroless, sin shell): el CLI de Prisma vive en
       // node_modules (dependencies) y se ejecuta como archivo con
       // `bun run <ruta>` — `bun run <script>` de package.json falla con
       // MissingShell y `npx` no existe. Fallar aquí mata el pod antes de que
       // el servidor sirva tráfico.
       command: ['bun'],
       args: ['run', '/app/node_modules/prisma/build/index.js', 'migrate', 'deploy'],
       requestCpu: null,
       requestMemory: null,
       pullPolicy: $.values.pullPolicy,
     } }).this,
  ],
  app: _app {
    values+:: container_values {
      containersInit: initContainer,
      requestCpu: '50m',
      requestMemory: '256Mi',
      // Techo por encima del request: Node deja crecer al GC antes de que el
      // límite mate el pod (el default de la lib sería request = limit).
      limitMemory: '512Mi',
      port: 8080,
      serverAlias: $.values.serverAlias,
      // Primera iteración (issue #30): la app no tiene /healthz; probes TCP
      // contra el puerto del servidor (kubelet habla directo a la IP del pod,
      // sin Service).
      livenessProbe: {
        tcpSocket: { port: 8080 },
        initialDelaySeconds: 5,
        periodSeconds: 10,
      },
      readinessProbe: {
        tcpSocket: { port: 8080 },
        initialDelaySeconds: 5,
        periodSeconds: 10,
        failureThreshold: 3,
      },
    } + $.values,
    app+: {
      // Los secrets van en wave 10 (default de la lib); el resto del app no
      // debe sincronizarse antes.
      service+: {
        metadata+: { annotations+: { 'argocd.argoproj.io/sync-wave': '50' } },
      },
      ingress+: {
        metadata+: { annotations+: { 'argocd.argoproj.io/sync-wave': '50' } },
      },
    },
  },
  secret: _secret {
    values+:: {
      name: 'y-tu-que-compras',
      namespace: tk.env.spec.namespace,
      stringData: {
        // Apunta al service -rw del Cluster CNPG (mismo dbClusterName que
        // db/dbCredentials); la password es la del secret de credenciales.
        DATABASE_URL: 'postgresql://ytqc:' + secrets.DB_APP_PASSWORD + '@'
                      + $.values.dbClusterName + '-rw.' + tk.env.spec.namespace + '.svc:5432/ytqc',
        BETTER_AUTH_SECRET: secrets.BETTER_AUTH_SECRET,
        // Email transaccional (OCI Email Delivery). Nótese el typo SMPT_: es
        // intencionado, así se leen en sender.ts. Sin estas variables la app
        // arranca, pero el login OTP falla al enviar el código.
        SMTP_HOST: secrets.SMTP_HOST,
        SMPT_AUTH_USER: secrets.SMPT_AUTH_USER,
        SMPT_AUTH_PASS: secrets.SMPT_AUTH_PASS,
        SMPT_SENDER: secrets.SMPT_SENDER,
        // Sal para etiquetar trazas con el hash del usuario (hooks.server.ts).
        OBSERVABILITY_SALT: secrets.OBSERVABILITY_SALT,
      },
    },
  },
  dbCredentials: _secret {
    values+:: {
      name: $.values.dbClusterName + '-credentials',
      namespace: tk.env.spec.namespace,
      stringData: { username: 'ytqc', password: secrets.DB_APP_PASSWORD },
    },
    secret+: {
      type: 'kubernetes.io/basic-auth',  // requerido por CNPG (initdb y managed roles)
      metadata+: { labels: { 'cnpg.io/reload': 'true' } },  // reconciliación de password inmediata
    },
  },
  dbBackupCredentials: _secret {
    values+:: {
      name: $.values.dbClusterName + '-backup-credentials',
      namespace: tk.env.spec.namespace,
      stringData: {
        ACCESS_KEY_ID: secrets.BACKUP_ACCESS_KEY_ID,
        ACCESS_SECRET_KEY: secrets.BACKUP_ACCESS_SECRET_KEY,
      },
    },
  },
  db: {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: {
      name: $.values.dbClusterName,
      namespace: tk.env.spec.namespace,
      labels: { owner: 'callepuzzle' },
      // Tras los secrets (wave 10, el bootstrap necesita las credenciales)
      // y antes del workload (wave 50, db-migrate necesita la BD).
      annotations: { 'argocd.argoproj.io/sync-wave': '15' },
    },
    spec: {
      instances: 1,
      bootstrap: {
        initdb: {
          database: 'ytqc',
          owner: 'ytqc',
          secret: { name: $.values.dbClusterName + '-credentials' },
        },
      },
      // Rotación de password declarativa: al cambiar el Secret, el operador ejecuta
      // ALTER ROLE automáticamente (initdb solo aplica en el bootstrap inicial).
      // El rol `ytqc` ya existe (lo crea initdb como owner) y se adopta sin conflictos.
      managed: {
        roles: [{
          name: 'ytqc',
          ensure: 'present',
          login: true,
          passwordSecret: { name: $.values.dbClusterName + '-credentials' },
        }],
      },
      storage: { size: '5Gi', storageClass: 'openebs-hostpath' },
      resources: { requests: { cpu: '100m', memory: '256Mi' } },
      // barman/boto3 moderno firma PutObject con AWS chunked encoding, que la
      // API S3-compatible de OCI rechaza con NotImplemented. Checksums solo
      // cuando se requieran (plugin-barman-cloud#393).
      env: [
        { name: 'AWS_REQUEST_CHECKSUM_CALCULATION', value: 'when_required' },
        { name: 'AWS_RESPONSE_CHECKSUM_VALIDATION', value: 'when_required' },
      ],
      // Backups físicos continuos (WAL archiving + base backups diarios) en
      // bucket OCI (tenancy villajilguero, namespace axcnsuaoa3od) vía API
      // S3-compatible. Bucket creado por Terraform (jilguedev/main.tf); el
      // usuario IAM dedicado es `jilguedev-db-backup`. Método barmanObjectStore
      // nativo: deprecado desde CNPG 1.26 pero operativo.
      backup: {
        retentionPolicy: '30d',
        barmanObjectStore: {
          destinationPath: 's3://jilguedev-db-backups/' + $.values.dbBackupPath,
          endpointURL: 'https://axcnsuaoa3od.compat.objectstorage.eu-madrid-1.oci.customer-oci.com',
          s3Credentials: {
            accessKeyId: { name: $.values.dbClusterName + '-backup-credentials', key: 'ACCESS_KEY_ID' },
            secretAccessKey: { name: $.values.dbClusterName + '-backup-credentials', key: 'ACCESS_SECRET_KEY' },
          },
          wal: { compression: 'gzip' },
        },
      },
    },
  },
  // Backup base diario (03:30 UTC). El WAL archiving ya queda activo con
  // spec.backup del Cluster; esto programa los base backups.
  dbBackupSchedule: {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'ScheduledBackup',
    metadata: {
      name: $.values.dbClusterName + '-backup',
      namespace: tk.env.spec.namespace,
      annotations: { 'argocd.argoproj.io/sync-wave': '20' },  // tras el Cluster (15)
    },
    spec: {
      schedule: '0 30 3 * * *',  // cron de 6 campos (con segundos): 03:30 UTC diaria
      immediate: true,  // primer backup al crear el recurso
      backupOwnerReference: 'self',
      cluster: { name: $.values.dbClusterName },
    },
  },
}
