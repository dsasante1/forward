import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a Zod schema and returns the *parsed* value
 * (with forward-core's defaults applied). This is liability #5 from the migration
 * doc fixed at the boundary: validation used to run only in the client before a
 * direct DB write, and the Firebase rules never checked payload shape. Now the
 * server re-validates every write with the SAME forward-core schemas, so the
 * contract is enforced server-side regardless of which client called.
 *
 * Usage:  `@Body(new ZodBody(DesignElement)) body: DesignElement`
 */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Request body failed validation",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
