# Draft: Agent View queued message disappears after switching tabs

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: User-observed behavior plus source-supported lifecycle explanation
>
> Readiness: Candidate after exact reproduction, `/about`, and visual evidence

## Suggested title

Agent Team: a queued Agent View message disappears after switching teammate tabs

## What happened?

While a teammate is busy in Agent View, I can submit a follow-up message and
see it in the queued-message display. If I switch to another Agent View tab
and then return, the queued message is no longer displayed and is not sent to
the teammate when it becomes idle.

I have observed the UI behavior. Before filing, I will attach the exact build
information and a short recording showing the submission, tab switch, and
missing delivery.

## What did you expect to happen?

Once Agent View accepts a submitted message and displays it as queued, changing
tabs should not discard it. The message should remain visible and should be
delivered exactly once when the teammate can accept it.

## Client information

<details>
<summary>Client Information</summary>

```console
$ qwen /about
# Paste the complete output from the reproducing build before filing.
```

</details>

Platform: Add before filing.

## Login information

Add the reproducing login/auth mode before filing. Do not include credentials.

## Anything else we need to know?

### Minimal reproduction

1. Create an Agent Team with at least two teammates.
2. Open teammate A in Agent View and start a turn that remains busy long
   enough to submit a follow-up.
3. Submit a follow-up message to teammate A.
4. Confirm the message appears in the queued-message display.
5. Switch to teammate B's tab.
6. Switch back to teammate A.
7. Allow teammate A's active turn to finish.

Actual result: the queued message disappears after the tab switch and is not
delivered after teammate A becomes idle.

Expected result: the accepted message remains queued across tab switches and
is delivered exactly once.

### Control

Repeat without switching tabs. Record whether the queued message remains
visible and is delivered when teammate A becomes idle.

### Source inspection

At commit `a6d30ebc6`, `AgentComposer` stores submitted follow-ups in local
React `messageQueue` state while the teammate is busy. `DefaultAppLayout`
renders `AgentComposer` with `key={activeView}`, so changing the active tab
unmounts that composer and its local queue. The runtime's
`AgentInteractive.enqueueMessage()` has its own durable-for-the-runtime queue,
but the composer calls it only after the teammate becomes idle.

Relevant files:

- `packages/cli/src/ui/components/agent-view/AgentComposer.tsx`
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`
- `packages/core/src/agents/runtime/agent-interactive.ts`

This source path is a plausible explanation for the observed loss. A focused
component test should confirm it before the report states a root cause.

### Scope

This is distinct from #8172. That issue concerns a message that reached the
coordination/runtime queue but was not made available at the next response
boundary. This report concerns a submitted message retained only by the
currently mounted Agent View composer and lost when the user changes tabs.

The report does not claim that unsent editor draft text is also lost.

<details>
<summary>中文</summary>

## 发生了什么？

当 teammate 正在 Agent View 中运行时，我可以提交一条 follow-up 消息，并在
queued-message 区域看到它。如果切换到另一个 teammate tab 再返回，这条消息
不再显示；当原 teammate 变为 idle 后，它也没有被发送。

我已经观察到该 UI 行为。提交 issue 前会附上完整 build 信息和短录屏，展示
消息提交、tab 切换以及最终未投递的过程。

## 预期行为是什么？

一旦 Agent View 接受并显示一条 queued 消息，切换 tab 不应丢弃它。消息应
继续可见，并在 teammate 可以接收时恰好投递一次。

## 客户端信息

提交前粘贴复现 build 的完整 `/about` 输出和平台。

## 登录信息

提交前添加复现使用的登录/认证方式，不得包含 credentials。

## 还需要知道什么？

最小复现步骤：

1. 创建包含至少两个 teammate 的 Agent Team。
2. 打开 teammate A，让它执行一个持续时间足够长的 turn。
3. 向 A 提交 follow-up，并确认它出现在 queued-message 区域。
4. 切换到 teammate B，再切回 A。
5. 等待 A 的当前 turn 完成。

实际结果：切换 tab 后 queued 消息消失，A 变为 idle 后也没有收到它。

预期结果：消息跨 tab 切换保持 queued，并且只投递一次。

源码检查发现一个可能原因：`AgentComposer` 在 teammate busy 时把消息保存在
本地 React state；`DefaultAppLayout` 使用 `key={activeView}`，切换 tab 会
卸载 composer 及其本地 queue。composer 只有在 teammate idle 后才调用
runtime 的 `enqueueMessage()`。在 component test 证明之前，这只能作为可能
原因。

此问题与 #8172 不同：#8172 涉及已进入协调/runtime queue 的消息延迟；这里
涉及只保存在当前 mounted composer 中、切换 tab 后丢失的消息。本报告不声称
尚未提交的 editor draft 也会丢失。

</details>

---

## Internal filing gate

- [ ] Reproduce on current `main`.
- [ ] Paste complete `/about` output and platform.
- [ ] Record login/auth mode and terminal environment.
- [ ] Attach a screenshot sequence or short recording.
- [ ] Record the no-tab-switch control.
- [ ] Add a component test that changes `activeView` while a message is queued.
- [ ] Re-run open and closed duplicate searches for `AgentComposer queue`,
      `queued message tab switch`, and `agent view message lost`.
