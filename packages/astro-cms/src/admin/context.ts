import { createContext, useContext } from "react";
import type { CmsConfig } from "../schema.ts";
import type { DocSummary } from "./api.ts";
import type { Path } from "./paths.ts";

export interface FormApi {
  config: CmsConfig;
  readOnly: boolean;
  errors: Map<string, string>;
  onChange: (path: Path, value: unknown) => void;
  /** Opens a block item in the form panel. */
  openItem: (path: Path) => void;
  /** Every document by `type:id`, for reference labels and pickers. */
  index: Map<string, DocSummary>;
  toast: (message: string, tone?: "error" | "info") => void;
}

export const FormContext = createContext<FormApi | null>(null);

export function useForm() {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useForm outside FormContext");
  return ctx;
}
