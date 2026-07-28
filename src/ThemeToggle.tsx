import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const themeStorageKey = "xiaopan:theme";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#151815" : "#f7f8f5");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const nextTheme = theme === "dark" ? "light" : "dark";

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (
        event.key === themeStorageKey &&
        (event.newValue === "light" || event.newValue === "dark")
      ) {
        setTheme(event.newValue);
      }
    }

    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  return (
    <button
      type="button"
      className="global-theme-toggle"
      aria-label={`切换到${nextTheme === "dark" ? "深色" : "浅色"}模式`}
      title={`切换到${nextTheme === "dark" ? "深色" : "浅色"}模式`}
      onClick={() => setTheme(nextTheme)}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      <span>{nextTheme === "dark" ? "深色" : "浅色"}</span>
    </button>
  );
}
