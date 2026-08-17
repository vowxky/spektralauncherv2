import "react";

declare module "react" {
  export const Activity: React.ExoticComponent<{
    mode: "visible" | "hidden";
    children?: React.ReactNode;
  }>;
}
