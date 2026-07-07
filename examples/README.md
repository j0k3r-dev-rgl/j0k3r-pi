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
- `tsconfig.json` plus `ui/*.tsx` — library-agnostic TSX fixtures for JSX reads, arbitrary wrappers, default exports, barrel re-exports, and path aliases (`@fixtures/ui`)

### JavaScript fixtures (`javascript/`)

- `vehicles.js` — class inheritance (`Vehicle`, `Car`, `Motorcycle`)
- `math.js` — functions, arrow functions, object methods
- `edge-cases.js` — destructured exported function bindings and callback arguments (`helper`, `useLater`, `run`)
- `index.js` — re-exports
- `jsconfig.json` plus `ui/*.jsx` — library-agnostic JSX fixtures for JSX reads, arbitrary wrappers, default exports, barrel re-exports, and path aliases (`@fixtures/ui`)

### Java fixtures (`java/`)

- `pom.xml` — minimal marker so `examples/java` is detected as its own graph subproject
- `Greeter.java` — interface (`Greeter`) and implementing class (`ConsoleGreeter`)
- `CallbackExamples.java` — lambda callback and method-reference usages for manual `find_references` checks (`helper`, `run`)
- `app/**` — library-agnostic application fixtures for user-owned interfaces/ports, custom annotations, adapters, use cases, normalizers, validators, providers/factories, records/enums/sealed types, wildcard imports, fluent builders, lambdas, and method references

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
find_symbol path:examples/java/app symbol:CreateUserInputPort language:java kind:interface
find_symbol path:examples/java/app symbol:ApplicationService language:java
find_references path:examples/java/app/ports/CreateUserInputPort.java symbol:CreateUserInputPort language:java kind:interface
find_references path:examples/java/app/ports/UserRepositoryPort.java symbol:UserRepositoryPort language:java kind:interface
find_references path:examples/java/app/pipeline/PipelineExample.java symbol:normalize language:java kind:method
function_call_tree path:examples/java/app/web/UserController.java symbol:handle language:java kind:method include_external:true
find_references path:examples/typescript/edge-cases.ts symbol:helper language:ts kind:function
find_symbol path:examples/typescript/ui/ViewWidget.tsx symbol:ViewWidget language:ts kind:function include_signature:true
find_references path:examples/typescript/ui/ViewWidget.tsx symbol:ViewWidget language:ts kind:function
find_references path:examples/typescript/ui/DefaultPanel.tsx symbol:DefaultPanel language:ts kind:function
find_references path:examples/javascript/edge-cases.js symbol:helper language:js kind:function
find_symbol path:examples/javascript/ui/view-widget.jsx symbol:ViewWidget language:js kind:function include_signature:true
find_references path:examples/javascript/ui/view-widget.jsx symbol:ViewWidget language:js kind:function
find_references path:examples/javascript/ui/default-panel.jsx symbol:DefaultPanel language:js kind:function
find_references path:examples/java/CallbackExamples.java symbol:helper language:java kind:method
reverse_function_call_tree path:examples/javascript/reverse-callers.js symbol:helper language:js kind:function
reverse_function_call_tree path:examples/java/reversecallers/AppService.java symbol:helper language:java kind:method
```

## Español

Estos archivos existen solo para probar las herramientas `find_symbol`, `find_references`, `function_call_tree` y `reverse_function_call_tree`. Nunca se ejecutan.

### Fixtures TypeScript (`typescript/`)

- `shapes.ts` — interfaces (`Shape`, `Drawable`) y clases que las implementan (`Circle`, `Rectangle`).
- `utils.ts` — funciones, variables con arrow functions y métodos de objeto (`add`, `subtract`, `fetchUserData`, `fetchPostData`, `mathUtils`).
- `vault.ts` — miembros privados (`private getSecret`, `#getHash`, `unlock`).
- `edge-cases.ts` — type aliases, funciones anidadas, alias de arrow functions y argumentos callback (`UserID`, `outer`, `inner`, `helper`, `register`).
- `advanced.ts` — clases abstractas, genéricos, getters, setters, constructores y métodos estáticos.
- `index.ts` — re-exports.
- `tsconfig.json` y `ui/*.tsx` — fixtures TSX agnósticos de librería para JSX reads, wrappers arbitrarios, default exports, barrel re-exports y aliases de path (`@fixtures/ui`).

### Fixtures JavaScript (`javascript/`)

- `vehicles.js` — herencia de clases (`Vehicle`, `Car`, `Motorcycle`).
- `math.js` — funciones, arrow functions y métodos de objeto.
- `edge-cases.js` — bindings de funciones exportadas con destructuring y argumentos callback (`helper`, `useLater`, `run`).
- `index.js` — re-exports.
- `jsconfig.json` y `ui/*.jsx` — fixtures JSX agnósticos de librería para JSX reads, wrappers arbitrarios, default exports, barrel re-exports y aliases de path (`@fixtures/ui`).

### Fixtures Java (`java/`)

- `pom.xml` — marker mínimo para que `examples/java` se detecte como subproyecto propio del grafo.
- `Greeter.java` — interface (`Greeter`) y clase que la implementa (`ConsoleGreeter`).
- `CallbackExamples.java` — callback lambda y usos de method reference para checks manuales de `find_references` (`helper`, `run`).
- `app/**` — fixtures de aplicación agnósticos de librería para interfaces/puertos propios, anotaciones custom, adapters, use cases, normalizers, validators, providers/factories, records/enums/sealed types, wildcard imports, fluent builders, lambdas y method references.

### Consultas de prueba sugeridas

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
find_symbol path:examples/java/app symbol:CreateUserInputPort language:java kind:interface
find_symbol path:examples/java/app symbol:ApplicationService language:java
find_references path:examples/java/app/ports/CreateUserInputPort.java symbol:CreateUserInputPort language:java kind:interface
find_references path:examples/java/app/ports/UserRepositoryPort.java symbol:UserRepositoryPort language:java kind:interface
find_references path:examples/java/app/pipeline/PipelineExample.java symbol:normalize language:java kind:method
function_call_tree path:examples/java/app/web/UserController.java symbol:handle language:java kind:method include_external:true
find_references path:examples/typescript/edge-cases.ts symbol:helper language:ts kind:function
find_symbol path:examples/typescript/ui/ViewWidget.tsx symbol:ViewWidget language:ts kind:function include_signature:true
find_references path:examples/typescript/ui/ViewWidget.tsx symbol:ViewWidget language:ts kind:function
find_references path:examples/typescript/ui/DefaultPanel.tsx symbol:DefaultPanel language:ts kind:function
find_references path:examples/javascript/edge-cases.js symbol:helper language:js kind:function
find_symbol path:examples/javascript/ui/view-widget.jsx symbol:ViewWidget language:js kind:function include_signature:true
find_references path:examples/javascript/ui/view-widget.jsx symbol:ViewWidget language:js kind:function
find_references path:examples/javascript/ui/default-panel.jsx symbol:DefaultPanel language:js kind:function
find_references path:examples/java/CallbackExamples.java symbol:helper language:java kind:method
reverse_function_call_tree path:examples/javascript/reverse-callers.js symbol:helper language:js kind:function
reverse_function_call_tree path:examples/java/reversecallers/AppService.java symbol:helper language:java kind:method
```
