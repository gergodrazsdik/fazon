// SPDX-License-Identifier: GPL-3.0-or-later

/** The format versions this core reads: the spec front matter's `fazon`, and fazon.yaml's `fazon`. */
export const formatVersions = {
  spec: 0,
  config: 0,
} as const;
