import { createContext, useContext } from "react";

import type { Session } from "../session/session";
import type { Translator } from "../i18n";

export interface AppContextValue {
  session: Session;
  t: Translator;
  language: "ja" | "en";
  setLanguage: (language: "ja" | "en") => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext is missing");
  return value;
}
