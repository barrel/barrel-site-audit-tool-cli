import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { StructureFlag, ThemeStructureSection } from "@barrel/site-audit-shared";

const PAGE_BUILDER_SIGNATURES: Record<string, RegExp> = {
  Shogun: /shogun/i,
  PageFly: /pagefly/i,
  EComposer: /ecomposer/i,
  GemPages: /gempages/i,
  Zipify: /zipify/i,
  Replo: /\breplo\b/i,
};

const JUNK_NAME_RE = /(^|[-_])(test|copy|backup|bak|old|tmp|deprecated)([-_.]|$)/i;
const HASH_NAME_RE = /^[0-9a-f]{6,}$/i;
const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

/** Recursively lists files with the given extensions, relative to `dir` (e.g. "customers/account.json"). */
function listFilesRecursive(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (sub: string) => {
    for (const entry of readdirSync(join(dir, sub))) {
      const relPath = sub ? `${sub}/${entry}` : entry;
      const fullPath = join(dir, relPath);
      if (statSync(fullPath).isDirectory()) {
        walk(relPath);
      } else if (exts.includes(extname(entry).toLowerCase())) {
        results.push(relPath);
      }
    }
  };
  walk("");
  return results;
}

function isReferencedElsewhere(name: string, ownPath: string, fileContents: Map<string, string>): boolean {
  for (const [path, content] of fileContents) {
    if (path !== ownPath && content.includes(name)) return true;
  }
  return false;
}

/** A section with a non-empty "presets" in its {% schema %} can be added manually via the theme
 * editor — being unreferenced by any template is normal for these, not a sign of dead code. */
function hasCustomizerPresets(content: string): boolean {
  const match = content.match(SCHEMA_RE);
  if (!match) return false;
  try {
    const schema = JSON.parse(match[1]);
    return Array.isArray(schema.presets) && schema.presets.length > 0;
  } catch {
    return false;
  }
}

export function analyzeThemeStructure(themeDir: string): ThemeStructureSection | null {
  if (!existsSync(themeDir)) return null;

  const templatesDir = join(themeDir, "templates");
  const sectionsDir = join(themeDir, "sections");
  const snippetsDir = join(themeDir, "snippets");
  const layoutDir = join(themeDir, "layout");

  const templateFiles = listFilesRecursive(templatesDir, [".json", ".liquid"]);
  const sectionFiles = listFilesRecursive(sectionsDir, [".liquid"]);
  const sectionJsonFiles = listFilesRecursive(sectionsDir, [".json"]); // section groups (header-group.json, etc.)
  const snippetFiles = listFilesRecursive(snippetsDir, [".liquid"]);
  const layoutFiles = listFilesRecursive(layoutDir, [".liquid"]);

  const jsonTemplates = templateFiles.filter((f) => f.endsWith(".json"));
  const liquidTemplates = templateFiles.filter((f) => f.endsWith(".liquid"));

  const fileContents = new Map<string, string>();
  const readInto = (dir: string, files: string[]) => {
    for (const f of files) {
      const path = join(dir, f);
      try {
        fileContents.set(path, readFileSync(path, "utf-8"));
      } catch {
        // unreadable file — skip
      }
    }
  };
  readInto(templatesDir, templateFiles);
  readInto(sectionsDir, sectionFiles);
  readInto(sectionsDir, sectionJsonFiles);
  readInto(snippetsDir, snippetFiles);
  readInto(layoutDir, layoutFiles);

  const combined = Array.from(fileContents.values()).join("\n");

  const redFlags: StructureFlag[] = [];
  const greenFlags: StructureFlag[] = [];

  let orphanedSnippets = 0;
  for (const snippet of snippetFiles) {
    const name = basename(snippet, ".liquid");
    const ownPath = join(snippetsDir, snippet);
    if (!isReferencedElsewhere(name, ownPath, fileContents)) {
      orphanedSnippets++;
      redFlags.push({
        label: `Orphaned snippet: ${snippet}`,
        detail: "Not referenced by any other theme file.",
        recommendation: `Confirm snippets/${snippet} is unused, then delete it — or if it's meant to be live, add a {% render '${name}' %} call in the section/template that should use it.`,
      });
    }
  }

  // A section is only flagged as orphaned if it's both unreferenced AND has no customizer
  // presets — sections with presets are meant to be merchant-added via the theme editor and
  // are normally never wired into a template directly.
  let orphanedSections = 0;
  for (const section of sectionFiles) {
    const name = basename(section, ".liquid");
    const ownPath = join(sectionsDir, section);
    const content = fileContents.get(ownPath) ?? "";
    if (!isReferencedElsewhere(name, ownPath, fileContents) && !hasCustomizerPresets(content)) {
      orphanedSections++;
      redFlags.push({
        label: `Orphaned section: ${section}`,
        detail: "Not referenced by any template or section group, and has no customizer presets to add it manually.",
        recommendation: `Delete sections/${section} if it's dead code, add it to the relevant template's JSON, or add a "presets" array to its {% schema %} block so merchants can add it via the theme customizer.`,
      });
    }
  }

  const junkFiles = [...templateFiles, ...sectionFiles, ...snippetFiles].filter((f) =>
    JUNK_NAME_RE.test(basename(f, extname(f))),
  );
  for (const f of junkFiles) {
    redFlags.push({
      label: `Leftover test/backup file: ${f}`,
      detail: "Filename suggests it's not meant for production.",
      recommendation: `Delete ${f} from the theme repo — confirm first it isn't referenced anywhere (grep the theme for its basename), then remove it and commit.`,
    });
  }

  const hashNamed = [...sectionFiles, ...snippetFiles].filter((f) => HASH_NAME_RE.test(basename(f, extname(f))));
  for (const f of hashNamed) {
    redFlags.push({
      label: `Auto-generated file: ${f}`,
      detail: "Hash-like filename, likely generated by a page-builder app.",
      recommendation: `Check whether the page-builder app that generated ${f} is still installed and the page it belongs to is still live; if the app was removed or the page rebuilt, delete this orphaned file.`,
    });
  }

  const detectedApps = Object.entries(PAGE_BUILDER_SIGNATURES)
    .filter(([, re]) => re.test(combined) || [...sectionFiles, ...snippetFiles].some((f) => re.test(f)))
    .map(([name]) => name);

  if (detectedApps.length > 1) {
    redFlags.push({
      label: `${detectedApps.length} competing page-builder apps detected`,
      detail: `${detectedApps.join(", ")} are each injecting their own templates/scripts.`,
      recommendation: `Standardize on one of ${detectedApps.join(", ")}: migrate pages built with the others to the one you're keeping, then uninstall the rest and delete their leftover sections/snippets/scripts to remove the duplicate script weight and conflicting template ownership.`,
    });
  }

  if (redFlags.length === 0) {
    greenFlags.push({ label: "No orphaned sections or snippets found", detail: "All theme files are referenced or addable via the customizer." });
  }
  if (junkFiles.length === 0) {
    greenFlags.push({ label: "No leftover test/backup files", detail: "Template and section names look production-ready." });
  }
  if (detectedApps.length <= 1) {
    greenFlags.push({
      label: "No competing page-builder apps",
      detail: detectedApps.length === 1 ? `Single app in use: ${detectedApps[0]}.` : "No page-builder app signatures detected.",
    });
  }

  const penalty =
    orphanedSnippets * 3 +
    orphanedSections * 4 +
    junkFiles.length * 8 +
    hashNamed.length * 5 +
    (detectedApps.length > 1 ? 15 : 0);
  const score = Math.max(0, Math.round(100 - penalty));

  return {
    score,
    templates: { total: templateFiles.length, json: jsonTemplates.length, liquid: liquidTemplates.length },
    sectionsCount: sectionFiles.length,
    snippetsCount: snippetFiles.length,
    pageBuilderApps: detectedApps,
    redFlags,
    greenFlags,
  };
}
