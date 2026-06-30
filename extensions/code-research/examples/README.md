# Example Fixtures for `code-research`

[English](#english) | [Español](#español)

## English

These files exist only for testing the `find_symbol`, `find_references`, `function_call_tree`, and `reverse_function_call_tree` tools. They are never executed.

### TypeScript fixtures (`typescript/`)

- `shapes.ts` — interfaces (`Shape`, `Drawable`) and implementing classes (`Circle`, `Rectangle`)
- `utils.ts` — functions, arrow-function variables, and object methods (`add`, `subtract`, `fetchUserData`, `fetchPostData`, `mathUtils`)
- `vault.ts` — private members (`private getSecret`, `#getHash`, `unlock`)
- `edge-cases.ts` — type aliases, nested functions, arrow-function aliases, and callback arguments (`UserID`, `outer`, `inner`, `helper`, `register`)
- `advanced.ts` — abstract classes, generics, getters, setters, constructors, static methods
- `index.ts` — re-exports

### JavaScript fixtures (`javascript/`)

- `vehicles.js` — class inheritance (`Vehicle`, `Car`, `Motorcycle`)
- `math.js` — functions, arrow functions, object methods
- `edge-cases.js` — destructured exported function bindings and callback arguments (`helper`, `useLater`, `run`)
- `index.js` — re-exports

### Java fixtures (`java/`)

- `Greeter.java` — interface (`Greeter`) and implementing class (`ConsoleGreeter`)
- `CallbackExamples.java` — lambda callback and method-reference usages for manual `find_references` checks (`helper`, `run`)

### Suggested test queries

```
find_symbol path:examples/typescript/shapes.ts symbol:Shape kind:interface
find_symbol path:examples/typescript/utils.ts symbol:fetchUserData include_signature:true
find_symbol path:examples/typescript/vault.ts symbol:getHash kind:method include_code:true
find_symbol path:examples/typescript symbol:fetch search_mode:prefix
find_symbol path:examples/javascript/vehicles.js symbol:Car kind:class
find_symbol path:examples/typescript/edge-cases.ts symbol:UserID
find_symbol path:examples/typescript/edge-cases.ts symbol:inner include_code:true
find_symbol path:examples/java/Greeter.java symbol:Greeter language:java kind:interface
find_symbol path:examples/java/Greeter.java symbol:greet language:java kind:method include_code:true
find_references path:examples/typescript/edge-cases.ts symbol:helper language:ts kind:function
find_references path:examples/javascript/edge-cases.js symbol:helper language:js kind:function
find_references path:examples/java/CallbackExamples.java symbol:helper language:java kind:method
reverse_function_call_tree path:examples/javascript/reverse-callers.js symbol:helper language:js kind:function
reverse_function_call_tree path:examples/java/reversecallers/AppService.java symbol:helper language:java kind:method
```

## Español

Fixtures de ejemplo para probar la extensión `code-research`.

### Resumen

Estos archivos existen solo para validar herramientas de análisis de código. No son parte de una aplicación real y no deben ejecutarse como runtime.

### Contenido

- Fixtures TypeScript.
- Fixtures JavaScript.
- Fixtures Java.
- Consultas sugeridas para probar símbolos, referencias y árboles de llamadas.

### Uso recomendado

Úsalos para pruebas automatizadas o manuales de `find_symbol`, `find_references`, `function_call_tree` y `reverse_function_call_tree`.

### Ver más

La sección en inglés lista los directorios de fixtures y consultas de prueba concretas.
