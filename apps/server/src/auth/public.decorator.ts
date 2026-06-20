import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Mark a route as not requiring a Clerk session (e.g. the health check). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
