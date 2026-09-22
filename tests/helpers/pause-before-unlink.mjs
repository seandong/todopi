// tests/helpers/pause-before-unlink.mjs
//
// 测试用的 preload：把 fs.unlinkSync 包一层，删到目标路径时**握手暂停**。
// 用 --import 注入被测子进程，产品代码一个字都不用改。
//
// 关键是 syncBuiltinESMExports()：Node 对内置模块的具名导入（`import { unlinkSync }`）
// 是实例化时的快照，光改 fs.unlinkSync 影响不到它——我一度据此断定这条路走不通，
// 那个结论是错的（Codex 第四轮评审指出并实测）。syncBuiltinESMExports() 会把
// 修改同步回已建立的具名导出绑定。
//
// 协议全用文件，不需要额外依赖：
//   TODOPI_TEST_PAUSE_PATH   要拦截的绝对路径
//   TODOPI_TEST_ARRIVED      到达时创建它，告诉测试「我停在这儿了」
//   TODOPI_TEST_PROCEED      自旋等它出现，出现了才继续删
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const target = process.env["TODOPI_TEST_PAUSE_PATH"];
const arrived = process.env["TODOPI_TEST_ARRIVED"];
const proceed = process.env["TODOPI_TEST_PROCEED"];

if (target && arrived && proceed) {
  const original = fs.unlinkSync.bind(fs);
  fs.unlinkSync = (path, ...rest) => {
    if (String(path) === target) {
      fs.writeFileSync(arrived, "1");
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(proceed) && Date.now() < deadline) { /* 自旋等放行 */ }
    }
    return original(path, ...rest);
  };
  syncBuiltinESMExports();
}
