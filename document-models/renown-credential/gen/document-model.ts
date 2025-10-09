import type { DocumentModelState } from "document-model";

export const documentModel: DocumentModelState = {
  author: {
    name: "Powerhouse Inc.",
    website: "https://www.powerhouse.inc",
  },
  description: "A Renown Credential",
  extension: "phrc",
  id: "renown/credential",
  name: "RenownCredential",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "",
          id: "ea1ea725-62a9-4e97-8f89-6b153b7af4ee",
          name: "manager",
          operations: [
            {
              description: "",
              errors: [],
              examples: [],
              id: "366dfd44-377f-42d7-949d-a8d82b6a909d",
              name: "INIT",
              reducer: "",
              schema:
                'input InitInput {\n  "Add your inputs here"\n  jwt: String!\n  issuer: String\n  subject: String\n  audience: String\n  payload: String\n}',
              scope: "global",
              template: "",
            },
            {
              description: "",
              errors: [],
              examples: [],
              id: "8d8ed639-f7c4-43a5-8644-85729bd5b7dc",
              name: "REVOKE",
              reducer: "",
              schema: "input RevokeInput {\n  jwt: String\n}",
              scope: "global",
              template: "",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '"{\\n  \\"jwt\\": null,\\n  \\"revoked\\": null,\\n  \\"issuer\\": null,\\n  \\"subject\\": null,\\n  \\"audience\\": null,\\n  \\"payload\\": null\\n}"',
          schema:
            'type RenownCredentialState {\n  "Add your global state fields here"\n  jwt: String\n  revoked: Boolean\n  issuer: String\n  subject: String\n  audience: String\n  payload: String\n}',
        },
        local: {
          examples: [],
          initialValue: '""',
          schema: "",
        },
      },
      version: 1,
    },
  ],
};
