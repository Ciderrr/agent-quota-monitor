import { createContext, useContext } from "react";
import { STRINGS, type Lang, type StringKey } from "./strings";

interface I18n {
  lang: Lang;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18n>({ lang: "zh", t: (k) => k });

export function makeT(lang: Lang): I18n {
  return {
    lang,
    t(key, params) {
      let s: string = STRINGS[lang][key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
  };
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export type { Lang, StringKey };
