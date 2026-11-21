// From coss ui (https://coss.com/ui), MIT License, Copyright (c) 2025 coss.com and Origin UI.
// Copied in with `npx shadcn@latest add @coss/<name>`; ours to edit.
import { Loader2Icon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
