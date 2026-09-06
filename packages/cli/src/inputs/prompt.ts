/**
 * The prompt — tier 3, and the whole of what
 * `cli-product.md` R2.5 gave up when it was amended to R2.5a–e.
 *
 * ## It costs no dependency, and that is half the amendment's argument
 *
 * `node:readline/promises` is Node core, like the `node:util` `parseArgs` this
 * program already reads its own arguments with, so Constitution IV is untouched.
 * R2.5's *"a prompt is a dependency"* is measured false in the package sense and
 * true in the other one — a prompt depends on a human and a terminal — and that
 * half is answered by {@link mayPrompt}'s conjunction rather than by an
 * argument.
 *
 * ## It is a fallback, never a default-generator
 *
 * Every question here is for a **required** input the flag tier and the `.env`
 * tier did not answer. An empty answer is not a value: it re-asks. That is the
 * one place a prompt could quietly become the thing R2.5a forbids — a prompt
 * that accepted `''` would be a tool inventing the empty string, and it would be
 * counted as `prompted=` in the provenance line, which is worse than inventing
 * it in source because it would carry a human's authority.
 */
import { createInterface } from 'node:readline/promises';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import type { ResolvedInput } from './resolve.js';

/** Where the questions are asked and answered. Injected, so a test drives it. */
export interface PromptIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

/**
 * Ask for each input, in the declaration's own order.
 *
 * The order is the declaration's rather than an alphabet's: whoever wrote the
 * declaration decided what an operator is asked first, and a comparator here
 * would take that decision away from them and give it to the alphabet.
 *
 * Each question names **what the value configures**, in the operator's terms —
 * the declaration's `describes` sentence, which is exactly the field that exists
 * for this. A prompt reading `SESSION_COOKIE_SECRET:` and nothing else asks a
 * person to answer a question they have not been told.
 */
export async function promptForInputs(
  inputs: readonly EnvironmentInput[],
  language: 'en' | 'pl',
  io: PromptIo,
): Promise<readonly ResolvedInput[]> {
  if (inputs.length === 0) return [];
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    const answers: ResolvedInput[] = [];
    for (const input of inputs) {
      io.output.write(`\n${input.describes[language]}\n`);
      let value = '';
      while (value.length === 0) {
        // An empty answer re-asks rather than resolving to `''`. See the header:
        // accepting it would be the tool inventing a value and reporting it as
        // one a human supplied.
        value = (await rl.question(`${input.name}: `)).trim();
      }
      answers.push({ name: input.name, value, provenance: 'prompt' });
    }
    return answers;
  } finally {
    rl.close();
  }
}
