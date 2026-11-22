const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")
const root = path.resolve(__dirname, "../../..")

function loadTs(file, imports = {}, modules = new Map()) {
    const absolute = path.resolve(file)
    if (modules.has(absolute)) return modules.get(absolute).exports
    const module = { exports: {} }
    modules.set(absolute, module)
    const source = fs.readFileSync(absolute, "utf8")
    const javascript = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true
        }
    }).outputText
    function resolve(name) {
        if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name]
        if (imports["*"]) return imports["*"]
        if (!name.startsWith(".")) return require(name)
        let relative = path.resolve(path.dirname(absolute), name)
        if (fs.existsSync(relative + ".ts")) relative += ".ts"
        else relative = path.join(relative, "index.ts")
        return loadTs(relative, imports, modules)
    }
    new Function("require", "module", "exports", javascript)(resolve, module, module.exports)
    return module.exports
}

const store = (value) => ({
    value,
    update(fn) {
        this.value = fn(this.value)
    },
    set(value) {
        this.value = value
    }
})
// Run the component's real functions with controlled DOM measurements and timers.
function componentFunctions(relative, names, state) {
    const source = fs
        .readFileSync(path.join(root, relative), "utf8")
        .split("</script>")[0]
        .replace(/^.*?<script[^>]*>/s, "")
    const ast = ts.createSourceFile(relative + ".ts", source, ts.ScriptTarget.Latest, true)
    const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    if (functions.length !== names.length) throw new Error("Missing component functions in " + relative)
    const javascript = ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText
    return new Function("state", `with (state) { ${javascript}; return { ${names.join(",")} }; }`)(state)
}

function fakeTimers() {
    let id = 0
    const tasks = new Map()
    return {
        setTimeout(fn, delay = 0) {
            tasks.set(++id, { fn, delay })
            return id
        },
        clearTimeout(id) {
            tasks.delete(id)
        },
        run(delay) {
            for (let i = 0; i < 30; i++) {
                const task = [...tasks].find(([, task]) => task.delay === delay)
                if (!task) return
                tasks.delete(task[0])
                task[1].fn()
            }
            throw new Error("Timer loop did not settle")
        }
    }
}
module.exports = { root, loadTs, store, ts, componentFunctions, fakeTimers }
