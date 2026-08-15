/**
 * Transitive licence audit.
 *
 * `pnpm audit:licenses`
 *
 * RFP §3.6 is absolute: "A Permissive OSI Approved License. Every dependency
 * must be compatible with permissive redistribution and with operating the code
 * as a network service. No AGPL or other strong copyleft in the dependency
 * path." A network service triggers AGPL's §13 whether or not we ship a binary,
 * so "we only run it" is not a defence.
 *
 * This walks the **resolved** graph from the installed tree, not the direct
 * dependencies in package.json, and reads each licence from the package as
 * installed on disk rather than from a registry query.
 *
 * Exit codes:
 *   0  every runtime dependency is on the allow list
 *   1  a forbidden licence, an unknown licence, or a package needing review
 *
 * The bias is deliberate: anything the policy cannot classify fails the build.
 * A silent normalisation of "SEE LICENSE IN LICENSE.md" into "MIT" is exactly
 * the mistake this exists to prevent.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Workspaces whose production dependencies we operate as a network service or
 * redistribute. This is the set the RFP claim is about.
 */
const RUNTIME_WORKSPACES = [
  "apps/facilitator",
  "apps/mcp-discovery",
  // A service we intend to operate publicly belongs in the audited graph. Left
  // out, its dependencies would ship unexamined while the report still claimed
  // to cover what we run.
  "apps/demo-seller",
  "packages/catalog",
  "packages/search",
];

/** Workspaces that exist to test, measure or benchmark. Never deployed. */
const TOOLING_WORKSPACES = [
  "apps/e2e-stellar",
  "packages/retrieval-eval",
  "e2e-harness/proxy",
  "e2e-harness/hono-repro",
];

/**
 * Permissive licences accepted without review.
 *
 * Deliberately short. Every addition is a decision someone has to defend, so
 * the list holds only licences whose permissive character is uncontroversial.
 */
const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "MIT-0",
]);

/** Strong copyleft. Their presence is a hard failure, not a discussion. */
const FORBIDDEN = [
  "AGPL",
  "GPL-2.0",
  "GPL-3.0",
  "GPL",
  "SSPL",
  "OSL",
  "EUPL",
  "CPAL",
];

/**
 * Licences that may or may not be acceptable depending on how the dependency is
 * used. Weak copyleft (MPL/LGPL/EPL/CDDL) is usually fine when a package is
 * consumed unmodified, but that is a judgement call, so it is surfaced rather
 * than assumed.
 */
const REVIEW = ["MPL", "LGPL", "EPL", "CDDL", "BUSL", "Elastic", "Commons Clause", "CC-BY"];

interface PackageRecord {
  name: string;
  version: string;
  license: string;
  licenseSource: "package.json" | "license-file" | "unresolved";
  category: "runtime" | "tooling" | "dev";
  verdict: "allowed" | "forbidden" | "review" | "unknown";
  paths: string[];
}

/** Resolved production graph of one workspace, as `name@version` keys. */
function prodGraph(workspace: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let json: unknown;
  try {
    const raw = execFileSync(
      "pnpm",
      ["--dir", join(ROOT, workspace), "list", "--prod", "--depth", "Infinity", "--json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT },
    );
    json = JSON.parse(raw);
  } catch {
    return out;
  }

  interface Node {
    version?: string;
    dependencies?: Record<string, Node>;
  }

  const walk = (deps: Record<string, Node> | undefined, trail: string[]): void => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      const key = `${name}@${node.version ?? "unknown"}`;
      const path = [...trail, key];
      const existing = out.get(key);
      if (existing) {
        // Keep one representative path per package; the full set explodes.
        if (existing.length < 3) existing.push(path.join(" › "));
        continue;
      }
      out.set(key, [path.join(" › ")]);
      walk(node.dependencies, path);
    }
  };

  for (const entry of Array.isArray(json) ? (json as Array<{ dependencies?: never }>) : []) {
    walk((entry as { dependencies?: Record<string, Node> }).dependencies, [workspace]);
  }
  return out;
}

/**
 * Index every package present in the pnpm store by `name@version`.
 *
 * Reading from disk is the point: it is the code that actually runs, and it
 * carries the LICENSE file the author shipped, which a registry query does not.
 */
function indexInstalledPackages(): Map<string, string> {
  const index = new Map<string, string>();
  const store = join(ROOT, "node_modules", ".pnpm");
  if (!existsSync(store)) return index;

  for (const entry of readdirSync(store)) {
    const inner = join(store, entry, "node_modules");
    if (!existsSync(inner)) continue;
    for (const scopeOrName of readdirSync(inner)) {
      const candidates = scopeOrName.startsWith("@")
        ? readdirSync(join(inner, scopeOrName)).map((n) => join(scopeOrName, n))
        : [scopeOrName];
      for (const rel of candidates) {
        const dir = join(inner, rel);
        const manifest = join(dir, "package.json");
        if (!existsSync(manifest)) continue;
        try {
          const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name && pkg.version) index.set(`${pkg.name}@${pkg.version}`, dir);
        } catch {
          /* an unreadable manifest is reported as unresolved below */
        }
      }
    }
  }
  return index;
}

const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "COPYING",
  "license",
  "license.md",
];

/** First line of evidence: the declared field. Second: the shipped file. */
function readLicense(dir: string): { license: string; source: PackageRecord["licenseSource"] } {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      license?: unknown;
      licenses?: Array<{ type?: string }>;
    };

    if (typeof pkg.license === "string" && pkg.license.trim()) {
      return { license: pkg.license.trim(), source: "package.json" };
    }
    if (typeof pkg.license === "object" && pkg.license !== null) {
      const type = (pkg.license as { type?: string }).type;
      if (type) return { license: type, source: "package.json" };
    }
    if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) {
      return { license: pkg.licenses[0].type, source: "package.json" };
    }
  } catch {
    /* fall through to the file */
  }

  for (const filename of LICENSE_FILENAMES) {
    const path = join(dir, filename);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").slice(0, 4000);
    // Only recognise unmistakable headers. Guessing from prose is how an
    // ambiguous licence becomes a false "MIT".
    if (/MIT License/i.test(text)) return { license: "MIT", source: "license-file" };
    if (/Apache License\s*\n?\s*Version 2\.0/i.test(text))
      return { license: "Apache-2.0", source: "license-file" };
    if (/BSD 3-Clause/i.test(text)) return { license: "BSD-3-Clause", source: "license-file" };
    if (/BSD 2-Clause/i.test(text)) return { license: "BSD-2-Clause", source: "license-file" };
    if (/ISC License/i.test(text)) return { license: "ISC", source: "license-file" };
    return { license: `SEE LICENSE IN ${filename}`, source: "license-file" };
  }

  return { license: "UNKNOWN", source: "unresolved" };
}

/** Split an SPDX expression into its constituent identifiers. */
function spdxTerms(expression: string): string[] {
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|or|and)\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function classify(license: string): PackageRecord["verdict"] {
  const normalized = license.trim();
  if (!normalized || /^unknown$/i.test(normalized) || /^unlicensed$/i.test(normalized)) {
    return "unknown";
  }
  if (/^see license in/i.test(normalized)) return "review";

  const terms = spdxTerms(normalized);

  // Any forbidden term anywhere is fatal, including inside a dual licence: we
  // will not rely on an unstated election between AGPL and something else.
  if (terms.some((t) => FORBIDDEN.some((f) => t.toUpperCase().startsWith(f.toUpperCase())))) {
    return "forbidden";
  }
  if (terms.some((t) => REVIEW.some((r) => t.toUpperCase().includes(r.toUpperCase())))) {
    return "review";
  }
  // A dual licence is acceptable when at least one option is on the allow list.
  if (terms.some((t) => ALLOWED.has(t))) return "allowed";
  return "unknown";
}

function main(): void {
  const installed = indexInstalledPackages();

  const runtime = new Map<string, string[]>();
  for (const workspace of RUNTIME_WORKSPACES) {
    for (const [key, paths] of prodGraph(workspace)) {
      const existing = runtime.get(key);
      if (existing) existing.push(...paths.slice(0, 1));
      else runtime.set(key, paths);
    }
  }

  const tooling = new Map<string, string[]>();
  for (const workspace of TOOLING_WORKSPACES) {
    for (const [key, paths] of prodGraph(workspace)) {
      if (runtime.has(key)) continue;
      if (!tooling.has(key)) tooling.set(key, paths);
    }
  }

  const records: PackageRecord[] = [];
  const seen = new Set<string>();

  const add = (key: string, paths: string[], category: PackageRecord["category"]): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const at = key.lastIndexOf("@");
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    // Workspace packages are ours; they carry the repository's own licence.
    if (name.startsWith("@stellar-bazaar/")) return;

    const dir = installed.get(key);
    const { license, source } = dir
      ? readLicense(dir)
      : { license: "UNKNOWN", source: "unresolved" as const };

    records.push({
      name,
      version,
      license,
      licenseSource: source,
      category,
      verdict: classify(license),
      paths: paths.slice(0, 3),
    });
  };

  for (const [key, paths] of runtime) add(key, paths, "runtime");
  for (const [key, paths] of tooling) add(key, paths, "tooling");

  records.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const runtimeRecords = records.filter((r) => r.category === "runtime");
  const forbidden = runtimeRecords.filter((r) => r.verdict === "forbidden");
  const unknown = runtimeRecords.filter((r) => r.verdict === "unknown");
  const review = runtimeRecords.filter((r) => r.verdict === "review");

  const licenceCounts: Record<string, number> = {};
  for (const record of runtimeRecords) {
    licenceCounts[record.license] = (licenceCounts[record.license] ?? 0) + 1;
  }

  // ---- OpenZeppelin exclusion -------------------------------------------
  // RFP §3.6 names the Relayer, its x402 plugin and the relayer SDK as out.
  // Checked by name across the whole resolved graph, runtime and tooling alike.
  const openzeppelin = records.filter(
    (r) => /openzeppelin/i.test(r.name) || /(^|[^a-z])relayer/i.test(r.name),
  );

  const artifact = {
    generatedAt: new Date().toISOString(),
    policy: {
      allowed: [...ALLOWED].sort(),
      forbidden: FORBIDDEN,
      review: REVIEW,
      note:
        "Scope is the resolved production graph of the workspaces we operate as a " +
        "network service. Tooling and dev dependencies are recorded but are not " +
        "part of the RFP claim.",
    },
    runtimeWorkspaces: RUNTIME_WORKSPACES,
    toolingWorkspaces: TOOLING_WORKSPACES,
    totals: {
      resolvedPackages: records.length,
      runtimePackages: runtimeRecords.length,
      toolingPackages: records.length - runtimeRecords.length,
      forbidden: forbidden.length,
      unknown: unknown.length,
      review: review.length,
    },
    runtimeLicenceCounts: Object.fromEntries(
      Object.entries(licenceCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    openzeppelinMatches: openzeppelin.map((r) => `${r.name}@${r.version}`),
    findings: { forbidden, unknown, review },
    packages: records,
  };

  const outDir = join(ROOT, "artifacts", "compliance");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "licenses.json"), `${JSON.stringify(artifact, null, 2)}\n`);

  const lines: string[] = [
    "Transitive licence audit",
    "========================",
    `generated ${artifact.generatedAt}`,
    "",
    `runtime workspaces : ${RUNTIME_WORKSPACES.join(", ")}`,
    `resolved packages  : ${artifact.totals.resolvedPackages}`,
    `runtime packages   : ${artifact.totals.runtimePackages}`,
    `tooling packages   : ${artifact.totals.toolingPackages}`,
    "",
    "runtime licences",
    "----------------",
    ...Object.entries(artifact.runtimeLicenceCounts).map(
      ([licence, count]) => `  ${String(count).padStart(4)}  ${licence}`,
    ),
    "",
    `openzeppelin/relayer matches: ${openzeppelin.length === 0 ? "none" : openzeppelin.map((r) => r.name).join(", ")}`,
    "",
    "runtime packages",
    "----------------",
    ...runtimeRecords.map(
      (r) => `  ${r.verdict.padEnd(9)} ${r.license.padEnd(24)} ${r.name}@${r.version}`,
    ),
  ];
  writeFileSync(join(outDir, "licenses.txt"), `${lines.join("\n")}\n`);

  console.log(lines.slice(0, 20).join("\n"));
  console.log(`\nwrote artifacts/compliance/licenses.{json,txt}`);

  let failed = false;
  for (const [label, group] of [
    ["FORBIDDEN", forbidden],
    ["UNKNOWN", unknown],
    ["NEEDS REVIEW", review],
  ] as const) {
    if (group.length === 0) continue;
    failed = true;
    console.error(`\n${label} (${group.length}):`);
    for (const record of group) {
      console.error(`  ${record.name}@${record.version}  ${record.license}`);
      console.error(`    via ${record.paths[0] ?? "(path unresolved)"}`);
    }
  }

  if (openzeppelin.length > 0) {
    failed = true;
    console.error(`\nOPENZEPPELIN/RELAYER PACKAGES PRESENT (${openzeppelin.length}):`);
    for (const record of openzeppelin) console.error(`  ${record.name}@${record.version}`);
  }

  if (failed) {
    console.error("\nlicence audit FAILED");
    process.exit(1);
  }
  console.log("\nlicence audit PASSED — runtime graph is permissively licensed");
}

main();
