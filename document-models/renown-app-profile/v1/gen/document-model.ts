import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "powerhouse/renown-app-profile",
  name: "RenownAppProfile",
  author: {
    name: "Powerhouse Inc.",
    website: "https://www.powerhouse.inc",
  },
  extension: "phap",
  description:
    "The public profile of an app identity (did:key) and the publisher who maintains it",
  specifications: [
    {
      state: {
        local: {
          schema: "",
          examples: [],
          initialValue: "",
        },
        global: {
          schema:
            "type RenownAppProfileState {\n  appDid: String\n  publisherDid: String\n  name: String\n  tagline: String\n  logo: String\n  website: String\n}",
          examples: [],
          initialValue:
            '{\n  "appDid": null,\n  "publisherDid": null,\n  "name": null,\n  "tagline": null,\n  "logo": null,\n  "website": null\n}',
        },
      },
      modules: [
        {
          id: "5bf298c2-359f-43b0-8c89-fd9efd187f24",
          name: "profile",
          description: "",
          operations: [
            {
              id: "dcc8a7ed-fff5-4215-97b0-ae3302e7dcf9",
              name: "SET_APP_DID",
              description:
                "Binds the profile to its app DID. Set once; repeating the same DID is a no-op.",
              schema: "input SetAppDidInput {\n  appDid: String!\n}",
              template: "",
              reducer: "",
              errors: [
                {
                  id: "invalid-app-did-error",
                  name: "InvalidAppDidError",
                  code: "INVALID_APP_DID",
                  description: "The app DID is not a did:key DID",
                  template: "",
                },
                {
                  id: "app-did-immutable-error",
                  name: "AppDidImmutableError",
                  code: "APP_DID_IMMUTABLE",
                  description: "The profile already belongs to another app DID",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "f3dff6ec-0ee2-4928-af7c-0251ff759275",
              name: "SET_PUBLISHER_DID",
              description:
                "Records the publisher (a did:pkh:eip155 wallet DID) who maintains the profile.",
              schema:
                "input SetPublisherDidInput {\n  publisherDid: String!\n}",
              template: "",
              reducer: "",
              errors: [
                {
                  id: "invalid-publisher-did-error",
                  name: "InvalidPublisherDidError",
                  code: "INVALID_PUBLISHER_DID",
                  description: "The publisher DID is not a did:pkh:eip155 DID",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "baca5b92-7ce1-45dc-a483-4dab2575a7b2",
              name: "SET_PROFILE",
              description:
                "Patches the public fields. A null or absent field is unchanged; an empty string clears it.",
              schema:
                "input SetProfileInput {\n  name: String\n  tagline: String\n  logo: String\n  website: String\n}",
              template: "",
              reducer: "",
              errors: [
                {
                  id: "app-did-not-set-error",
                  name: "AppDidNotSetError",
                  code: "APP_DID_NOT_SET",
                  description:
                    "SET_APP_DID must run before the profile is edited",
                  template: "",
                },
                {
                  id: "invalid-website-error",
                  name: "InvalidWebsiteError",
                  code: "INVALID_WEBSITE",
                  description: "The website is not an http(s) URL",
                  template: "",
                },
                {
                  id: "invalid-logo-error",
                  name: "InvalidLogoError",
                  code: "INVALID_LOGO",
                  description:
                    "The logo is neither an https URL nor a base64 image data URL",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
