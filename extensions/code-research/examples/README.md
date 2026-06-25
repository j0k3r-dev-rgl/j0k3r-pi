# Example Fixtures for `code-research`

These files exist only for testing the `find_symbol` tool. They are never executed.

## TypeScript fixtures (`typescript/`)

- `shapes.ts` — interfaces (`Shape`, `Drawable`) and implementing classes (`Circle`, `Rectangle`)
- `utils.ts` — functions, arrow-function variables, and object methods (`add`, `subtract`, `fetchUserData`, `fetchPostData`, `mathUtils`)
- `vault.ts` — private members (`private getSecret`, `#getHash`, `unlock`)
- `edge-cases.ts` — type aliases and nested function declarations (`UserID`, `outer`, `inner`)
- `advanced.ts` — abstract classes, generics, getters, setters, constructors, static methods
- `index.ts` — re-exports

## JavaScript fixtures (`javascript/`)

- `vehicles.js` — class inheritance (`Vehicle`, `Car`, `Motorcycle`)
- `math.js` — functions, arrow functions, object methods
- `index.js` — re-exports

## Java fixtures (`java/`)

- `Greeter.java` — interface (`Greeter`) and implementing class (`ConsoleGreeter`)

## Suggested test queries

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
```
