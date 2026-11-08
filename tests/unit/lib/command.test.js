// 命令行拆分 / 合并：界面上是「程序」与「参数」两个输入框，存进 XML 是一整串。
// 拆错了会拿到半个路径，合错了会让含空格的命令在 Windows 上找不到程序。

import { describe, it, expect } from "vitest";
import { splitCommand, mergeCommand } from "../../../src/lib/command.js";

describe("拆分", () => {
  it("按首个可执行词切开，引号与空格都不算分隔", () => {
    expect(splitCommand('"C:\\Program Files\\App\\app.exe" -a -b')).toEqual({
      command: "C:\\Program Files\\App\\app.exe",
      arguments: "-a -b",
    });
    expect(splitCommand("cmd.exe /c echo hi")).toEqual({
      command: "cmd.exe",
      arguments: "/c echo hi",
    });
    expect(splitCommand("powershell -File script.ps1")).toEqual({
      command: "powershell",
      arguments: "-File script.ps1",
    });
    expect(splitCommand("C:\\Program Files\\App\\app.exe -a")).toEqual({
      command: "C:\\Program Files\\App\\app.exe",
      arguments: "-a",
    });
  });

  it("整行就是程序时参数为空", () => {
    expect(splitCommand("notepad.exe")).toEqual({ command: "notepad.exe", arguments: "" });
  });

  it("空串拆成两个空串，不返回 undefined", () => {
    expect(splitCommand("")).toEqual({ command: "", arguments: "" });
  });
});

describe("合并", () => {
  it("程序含空格时补引号，已有引号的不重复加", () => {
    expect(mergeCommand("C:\\Program Files\\App\\app.exe", "-a")).toBe(
      '"C:\\Program Files\\App\\app.exe" -a'
    );
    expect(mergeCommand('"C:\\p f\\a.exe"', "-a")).toBe('"C:\\p f\\a.exe" -a');
  });

  it("拆了再合回到原串（往返不丢引号）", () => {
    const plain = splitCommand("cmd.exe /c echo hi");
    expect(mergeCommand(plain.command, plain.arguments)).toBe("cmd.exe /c echo hi");

    const quoted = splitCommand('"C:\\Program Files\\App\\app.exe" -a -b');
    expect(mergeCommand(quoted.command, quoted.arguments)).toBe(
      '"C:\\Program Files\\App\\app.exe" -a -b'
    );
  });
});
