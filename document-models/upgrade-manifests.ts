/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { UpgradeManifest } from "document-model";
import { renownCredentialUpgradeManifest } from "document-models/renown-credential/upgrades";
import { renownOidcClientUpgradeManifest } from "document-models/renown-oidc-client/upgrades";
import { renownUserUpgradeManifest } from "document-models/renown-user/upgrades";

export const upgradeManifests: UpgradeManifest<readonly number[]>[] = [
  renownCredentialUpgradeManifest,
  renownOidcClientUpgradeManifest,
  renownUserUpgradeManifest,
];
