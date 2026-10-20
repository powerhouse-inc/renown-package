import { compileDeclarativeMatchers, type DeepsecPlugin } from "deepsec/config";

const specs = [
  {
    "version": 1,
    "slug": "renown-oidc-provider-bindings",
    "description": "Switchboard OIDC route registrations, handler construction, and SIWE/PKCE verification implementations.",
    "noiseTier": "normal",
    "filePatterns": [
      "subgraphs/renown-oidc/index.ts",
      "subgraphs/renown-oidc/http/handlers.ts",
      "subgraphs/renown-oidc/core/siwe.ts",
      "subgraphs/renown-oidc/core/pkce.ts"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*this\\.http\\.(?:get|post)\\(\\s*[\"']oidc/(?:\\.well-known/openid-configuration|jwks|authorize|interaction/:id(?:/complete)?|token|userinfo)[\"']\\s*,",
        "flags": "m",
        "label": "Switchboard OIDC HTTP route registration"
      },
      {
        "source": "^export function createOidcHandlers\\(deps: OidcDeps\\)",
        "flags": "m",
        "label": "OIDC HTTP handler factory"
      },
      {
        "source": "^export async function (?:verifySiweLogin|verifyPkceS256)\\(",
        "flags": "m",
        "label": "OIDC login and code-verifier validation"
      }
    ],
    "examples": [
      "this.http.get(\"oidc/authorize\", PUBLIC, (req) => handlers.authorize(req)),",
      "export function createOidcHandlers(deps: OidcDeps) {",
      "export async function verifySiweLogin(",
      "export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {"
    ],
    "closesSurfaceIds": [
      "oidc-provider-http"
    ]
  },
  {
    "version": 1,
    "slug": "renown-workload-registry-bindings",
    "description": "Named workload identity GraphQL resolver bindings, schema fields, and registry implementations.",
    "noiseTier": "normal",
    "filePatterns": [
      "subgraphs/renown-workload/resolvers.ts",
      "subgraphs/renown-workload/registry.ts",
      "subgraphs/renown-workload/schema.ts"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*(?:workloadIdentity|registerWorkloadIdentity|updateWorkloadIdentity|deleteWorkloadIdentity|issueAppStatsToken):[ \\t]*async[ \\t]*\\(",
        "flags": "m",
        "label": "Workload registry GraphQL resolver binding"
      },
      {
        "source": "^export[ \\t]+(?:async[ \\t]+)?function[ \\t]+(?:register|update|delete|get)WorkloadIdentity\\(",
        "flags": "m",
        "label": "Workload identity registry implementation"
      },
      {
        "source": "^[ \\t]*(?:workloadIdentity|registerWorkloadIdentity|updateWorkloadIdentity|deleteWorkloadIdentity|issueAppStatsToken)[ \\t]*\\(",
        "flags": "m",
        "label": "Workload registry GraphQL schema field"
      }
    ],
    "examples": [
      "registerWorkloadIdentity: async (",
      "export async function registerWorkloadIdentity(",
      "issueAppStatsToken(did: String!): AppStatsToken!"
    ],
    "closesSurfaceIds": [
      "workload-identity-registry-rpc"
    ]
  },
  {
    "version": 1,
    "slug": "renown-media-route-bindings",
    "description": "Switchboard media route mounts, typed handlers, storage backend factories, and host attachment reservations.",
    "noiseTier": "normal",
    "filePatterns": [
      "media/register.ts",
      "media/upload-route.ts",
      "media/media-route.ts",
      "media/backend.ts",
      "media/registry.ts",
      "media/filesystem-backend.ts",
      "media/s3-backend.ts"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*module\\.http\\.(?:post\\(\\s*[\"']media/uploads[\"']|get\\(\\s*[\"']media/:documentId/:field[\"'])\\s*,",
        "flags": "m",
        "label": "Switchboard upload and public image route registration"
      },
      {
        "source": "^export function create(?:UploadHandler|MediaHandler)\\(deps: (?:UploadRouteDeps|MediaRouteDeps)\\): RouteHandler[ \\t]*\\{",
        "flags": "m",
        "label": "Typed media HTTP handler factory"
      },
      {
        "source": "^export function create(?:S3|Filesystem)?MediaBackend\\(",
        "flags": "m",
        "label": "Media storage backend construction"
      },
      {
        "source": "^[ \\t]*const result = await attachments\\.reserve\\(",
        "flags": "m",
        "label": "Host attachment reservation boundary"
      }
    ],
    "examples": [
      "module.http.post(\"media/uploads\", { auth: \"renown\", maxBodyBytes: 4096 }, createUploadHandler({ backend: mediaBackend })),",
      "module.http.get(\n      \"media/:documentId/:field\",",
      "export function createUploadHandler(deps: UploadRouteDeps): RouteHandler {",
      "export function createMediaHandler(deps: MediaRouteDeps): RouteHandler {",
      "export function createS3MediaBackend(deps: S3MediaBackendDeps): MediaBackend {",
      "const result = await attachments.reserve(options, (handle) => Promise.reject(new Captured(handle)));"
    ],
    "closesSurfaceIds": [
      "media-http"
    ]
  },
  {
    "version": 1,
    "slug": "renown-maintenance-job-wiring",
    "description": "Renown maintenance timer registrations, sweep-job assembly and execution, and startup statistics backfills.",
    "noiseTier": "normal",
    "filePatterns": [
      "subgraphs/renown-orgs/index.ts",
      "subgraphs/renown-orgs/jobs.ts",
      "subgraphs/renown-orgs/core/sweeper.ts",
      "subgraphs/renown-oidc/index.ts",
      "subgraphs/renown-stats/index.ts",
      "subgraphs/renown-stats/core/backfill.ts",
      "subgraphs/renown-stats/core/category-backfill.ts"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*this\\.#(?:cleanupTimer|timer)[ \\t]*=[ \\t]*setInterval\\(\\(\\)[ \\t]*=>[ \\t]*\\{",
        "flags": "m",
        "label": "OIDC cleanup and organization sweep timer registration"
      },
      {
        "source": "^export function sweepJobs\\(rt: OrgRuntime\\): SweepJob\\[\\][ \\t]*\\{",
        "flags": "m",
        "label": "Organization maintenance job registry"
      },
      {
        "source": "^export function createSweeper\\(deps:[ \\t]*\\{",
        "flags": "m",
        "label": "Claimed maintenance job executor"
      },
      {
        "source": "^[ \\t]*this\\.#backfill[ \\t]*=[ \\t]*backfillAppMetricValues\\(deps\\)",
        "flags": "m",
        "label": "Statistics startup backfill dispatch"
      },
      {
        "source": "^export async function backfillApp(?:MetricValues|Categories)\\(deps: (?:BackfillDeps|CategoryBackfillDeps)\\): Promise<(?:BackfillResult|CategoryBackfillResult)>[ \\t]*\\{",
        "flags": "m",
        "label": "Statistics maintenance backfill implementation"
      }
    ],
    "examples": [
      "this.#cleanupTimer = setInterval(() => {",
      "this.#timer = setInterval(() => {",
      "export function sweepJobs(rt: OrgRuntime): SweepJob[] {",
      "export function createSweeper(deps: {",
      "this.#backfill = backfillAppMetricValues(deps)",
      "export async function backfillAppMetricValues(deps: BackfillDeps): Promise<BackfillResult> {",
      "export async function backfillAppCategories(deps: CategoryBackfillDeps): Promise<CategoryBackfillResult> {"
    ],
    "closesSurfaceIds": [
      "scheduled-and-startup-maintenance"
    ]
  },
  {
    "version": 1,
    "slug": "powerhouse-renown-processor-factories",
    "description": "Switchboard processor registration, typed Renown processor factory builders, and relational operation processors.",
    "noiseTier": "normal",
    "filePatterns": [
      "processors/switchboard.ts",
      "processors/renown-user/factory.ts",
      "processors/renown-user/processor.ts",
      "processors/renown-credential/factory.ts",
      "processors/renown-credential/processor.ts"
    ],
    "patterns": [
      {
        "source": "^export const processorFactoryBuilders:[ \\t]*ProcessorFactoryBuilder\\[\\][ \\t]*=[ \\t]*\\[",
        "flags": "m",
        "label": "Switchboard processor factory registry"
      },
      {
        "source": "^export const renown(?:User|Credential)FactoryBuilder:[ \\t]*ProcessorFactoryBuilder[ \\t]*=",
        "flags": "m",
        "label": "Typed Renown document-operation processor factory"
      },
      {
        "source": "^export class Renown(?:User|Credential)Processor extends RelationalDbProcessor<DB>[ \\t]*\\{",
        "flags": "m",
        "label": "Powerhouse relational document-operation processor"
      }
    ],
    "examples": [
      "export const processorFactoryBuilders: ProcessorFactoryBuilder[] = [",
      "export const renownUserFactoryBuilder: ProcessorFactoryBuilder =",
      "export const renownCredentialFactoryBuilder: ProcessorFactoryBuilder =",
      "export class RenownUserProcessor extends RelationalDbProcessor<DB> {",
      "export class RenownCredentialProcessor extends RelationalDbProcessor<DB> {"
    ],
    "closesSurfaceIds": [
      "reactor-operation-processors"
    ]
  },
  {
    "version": 1,
    "slug": "powerhouse-renown-reducer-maps",
    "description": "Typed handwritten Renown operation maps invoked by the generated Powerhouse document reducers.",
    "noiseTier": "normal",
    "filePatterns": [
      "document-models/renown-*/v1/src/reducers/*.ts"
    ],
    "patterns": [
      {
        "source": "^export const renown[A-Z][A-Za-z0-9]*Operations:[ \\t]*Renown[A-Z][A-Za-z0-9]*Operations[ \\t]*=[ \\t\\r\\n]*\\{",
        "flags": "m",
        "label": "Typed Powerhouse document-operation reducer map"
      }
    ],
    "examples": [
      "export const renownCredentialManagerOperations: RenownCredentialManagerOperations =\n  {",
      "export const renownOidcClientClientOperations: RenownOidcClientClientOperations =\n  {",
      "export const renownUserProfileOperations: RenownUserProfileOperations = {"
    ],
    "closesSurfaceIds": [
      "document-action-reducers"
    ]
  },
  {
    "version": 1,
    "slug": "connect-nginx-location-bindings",
    "description": "Connect Nginx static, SPA, service-worker, and health location registrations and their configuration templating.",
    "noiseTier": "normal",
    "filePatterns": [
      "docker/nginx.conf",
      "docker/connect-entrypoint.sh"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*location[ \\t]+(?:(?:=[ \\t]+)?\\$\\{PH_CONNECT_BASE_PATH\\}(?:/(?:assets/|fonts/|service-worker\\.js))?|/health)[ \\t]*\\{",
        "flags": "m",
        "label": "Connect static and health Nginx location registration"
      },
      {
        "source": "^[ \\t]*location[ \\t]+~[ \\t]+\\$\\{PH_CONNECT_BASE_PATH\\}/",
        "flags": "m",
        "label": "Connect base-path regular-expression location registration"
      },
      {
        "source": "^envsubst[ \\t]+'\\$\\{PORT\\},\\$\\{PH_CONNECT_BASE_PATH\\}'[ \\t]+<[ \\t]+/etc/nginx/nginx\\.conf\\.template[ \\t]+>[ \\t]+/etc/nginx/nginx\\.conf[ \\t]*$",
        "flags": "m",
        "label": "Connect Nginx configuration template activation"
      }
    ],
    "examples": [
      "location /health {",
      "location ${PH_CONNECT_BASE_PATH}/assets/ {",
      "location = ${PH_CONNECT_BASE_PATH}/service-worker.js {",
      "location ${PH_CONNECT_BASE_PATH} {",
      "location ~ ${PH_CONNECT_BASE_PATH}/(?!index\\.html$)([^/]+\\.[a-zA-Z0-9]+)$ {",
      "envsubst '${PORT},${PH_CONNECT_BASE_PATH}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf"
    ],
    "closesSurfaceIds": [
      "connect-static-http"
    ]
  },
  {
    "version": 1,
    "slug": "renown-operational-shell-dispatch",
    "description": "Container Switchboard and Nginx invocation boundaries and the release-channel deployment-target dispatcher.",
    "noiseTier": "normal",
    "filePatterns": [
      "docker/connect-entrypoint.sh",
      "docker/switchboard-entrypoint.sh",
      "scripts/ci/deploy-target.sh"
    ],
    "patterns": [
      {
        "source": "^[ \\t]*(?:exec[ \\t]+)?ph[ \\t]+switchboard[ \\t]+--(?:port|migrate)(?:[ \\t]|$)",
        "flags": "m",
        "label": "Switchboard server launch or migration invocation"
      },
      {
        "source": "^[ \\t]*exec[ \\t]+nginx[ \\t]+-g[ \\t]+[\"']daemon[ \\t]+off;[\"']",
        "flags": "m",
        "label": "Connect Nginx foreground launch"
      }
    ],
    "examples": [
      "exec ph switchboard --port ${PORT:-3000}",
      "ph switchboard --migrate",
      "exec nginx -g \"daemon off;\""
    ],
    "closesSurfaceIds": [
      "operational-shell-entrypoints"
    ]
  },
  {
    "version": 1,
    "slug": "renown-credential-manager-binding",
    "description": "Typed credential operation map invoked by the generated Powerhouse reducer for INIT and REVOKE, including multiline declarations.",
    "noiseTier": "normal",
    "filePatterns": [
      "document-models/renown-credential/v*/src/reducers/manager.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "document-models/renown-credential/v1/gen/reducer.ts"
      ]
    },
    "patterns": [
      {
        "source": "^export[ \\t]+const[ \\t]+renownCredentialManagerOperations[ \\t]*:",
        "flags": "m",
        "label": "Credential reducer operation-map declaration"
      }
    ],
    "examples": [
      "export const renownCredentialManagerOperations: RenownCredentialManagerOperations ="
    ],
    "closesSurfaceIds": [
      "document-action-reducers"
    ]
  },
  {
    "version": 1,
    "slug": "renown-release-channel-dispatch",
    "description": "Bash positional-argument dispatch selecting Renown Helm values for the deployment workflow.",
    "noiseTier": "normal",
    "filePatterns": [
      "scripts/ci/deploy-target.sh"
    ],
    "requires": {
      "sentinelFiles": [
        ".github/workflows/sync-and-publish.yml"
      ]
    },
    "patterns": [
      {
        "source": "^case[ \\t]+\"\\$\\{1:-\\}\"[ \\t]+in(?:[ \\t]|$)",
        "flags": "m",
        "label": "Release-channel CLI case dispatch"
      }
    ],
    "examples": [
      "case \"${1:-}\" in"
    ],
    "closesSurfaceIds": [
      "operational-shell-entrypoints"
    ]
  }
];

export const generatedMatchersPlugin: DeepsecPlugin = {
  name: "deepsec-generated-matchers",
  matchers: compileDeclarativeMatchers(specs),
};
