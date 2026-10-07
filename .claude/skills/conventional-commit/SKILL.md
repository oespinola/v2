---
name: conventional-commit
description: >-
  Arma y ejecuta commits con mensajes en formato Conventional Commits
  (tipo(scope): descripción) a partir de lo que realmente cambió. Se usa cada vez
  que el usuario pide commitear, guardar un cambio en Git, hacer un commit o
  proponer un mensaje de commit, aunque no mencione el formato.
allowed-tools:
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git log *)
---

# Conventional Commit

## Estado actual del repo

- Archivos modificados: !`git status --short`
- Últimos commits: !`git log --oneline -5`

## Pasos

1. **Mirá qué cambió de verdad** antes de escribir una palabra: `git diff` (sin
   stagear) y `git diff --staged` (lo que va a entrar). El mensaje describe el
   diff, no la conversación.
2. **Stageá solo lo que corresponde** con `git add <archivos>` (nunca `git add .`
   a ciegas). Nunca stagees secretos (`.env`, keys, tokens). Si hay cambios de
   temas distintos, proponé **un commit por tema** y confirmalo con el usuario.
3. **Elegí el tipo** según el cambio:

   | Tipo       | Cuándo                                          |
   |------------|-------------------------------------------------|
   | `feat`     | funcionalidad nueva para el usuario             |
   | `fix`      | corrige un bug                                  |
   | `docs`     | solo documentación (PRD, README, guías)         |
   | `refactor` | cambia código sin cambiar comportamiento        |
   | `test`     | agrega o corrige tests                          |
   | `chore`    | mantenimiento: config, deps, tooling, skills    |

4. **Escribí el mensaje** con el formato `tipo(scope): descripción`:

   | Regla                      | Detalle                                                                                         |
   |----------------------------|-------------------------------------------------------------------------------------------------|
   | Scope (opcional)           | la parte del proyecto que toca (`prd`, `auth`, `tickets`, `skills`)                             |
   | Descripción                | en imperativo, en minúscula, sin punto final, ≤ 72 caracteres en total                          |
   | Idioma                     | el mismo que ya usa el historial del repo; si no hay historial, español                         |
   | Si el por qué no es obvio  | agregá un cuerpo (línea en blanco + 1-3 líneas)                                                 |
   | Si rompe compatibilidad    | `!` después del tipo (`feat(api)!: ...`) y un pie `BREAKING CHANGE: <qué se rompe y cómo migrar>` |

5. **Commiteá** pasando el mensaje con un heredoc para respetar los saltos de línea:

   ```bash
   git commit -F - <<'EOF'
   tipo(scope): descripción

   Cuerpo opcional explicando el por qué.
   EOF
   ```

   Después mostrá el resultado con `git log --oneline -1`.

## Ejemplos

Correctos:

```text
docs(prd): endurecer PRD de TicketTriage con create-prd
chore(skills): agregar create-prd y conventional-commit
feat(tickets): rechazar tickets con asunto vacío
fix(auth): expirar la sesión tras 24 h de inactividad
```

Incorrectos: `update`, `cambios varios`, `Arreglé cosas.` (no dicen qué ni dónde).

## Reglas duras

- Nunca `--no-verify`, `--amend` ni `push` salvo pedido explícito del usuario.
- Si no hay nada para commitear, decilo y no crees un commit vacío.
