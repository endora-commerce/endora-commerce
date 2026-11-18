/**
 * `returns`' test support (`@endora-commerce/test-kit/support`): the tables of this
 * module whose rows must not survive from one test file into the next.
 *
 * **Why the clauses are here (`specs/180-off-platform-complaints/`).**
 * `return_case_clauses` has no foreign key to anything the harness truncates, so a
 * clause a file created stood for every later file on the same worker database. An
 * active `must_accept` clause is not inert data: it makes every later filing that
 * does not accept it a `RETURN_CLAUSES_NOT_ACCEPTED` refusal. A test that needs a
 * clause writes its own.
 */
export const volatileTables: readonly string[] = ['return_case_clauses'];
