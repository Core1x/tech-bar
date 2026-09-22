// 语言色点：GitHub 官方语言色，未收录语言用中性灰
const LANGUAGE_COLORS: Record<string, string> = {
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Go: "#00ADD8",
  "C++": "#f34b7d",
  C: "#555555",
  Java: "#b07219",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#663399",
  Vue: "#41b883",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "Jupyter Notebook": "#DA5B0B",
  Dart: "#00B4AB",
  Lua: "#000080",
  Zig: "#ec915c",
  Elixir: "#6e4a7e",
  Clojure: "#db5855",
  R: "#198CE7",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Julia: "#a270ba",
  "C#": "#178600",
  "Objective-C": "#438eff",
  TeX: "#3D6117",
  MDX: "#fcb32c",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  PowerShell: "#012456",
  GLSL: "#5686a5",
  Nix: "#7e7eff",
  "Jinja": "#a52a22",
};

const DEFAULT_COLOR = "#8b949e";

export function langColor(language: string | null): string {
  if (!language) return DEFAULT_COLOR;
  return LANGUAGE_COLORS[language] ?? DEFAULT_COLOR;
}

export function LangDot({ language, className = "" }: { language: string | null; className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: langColor(language) }}
      aria-hidden
    />
  );
}
