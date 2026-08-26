# Public feature request draft: ACP execution adapter for ordinary agents

> Filing status: Ready for final review after design link is pushed
>
> Classification: Feature request
>
> Related: [#10078](https://github.com/QwenLM/qwen-code/issues/10078),
> [#8545](https://github.com/QwenLM/qwen-code/issues/8545), and
> [#8105](https://github.com/QwenLM/qwen-code/issues/8105), and
> [#8775](https://github.com/QwenLM/qwen-code/issues/8775)

## Suggested title

Add an experimental ACP execution adapter for ordinary agents

## What would you like to be added?

Add an experimental stdio ACP execution adapter behind Qwen Code's existing
ordinary-agent lifecycle.

Ordinary agents already support foreground/background execution, task
identities, `list_agents`, follow-up through `send_message`, cancellation
through `task_stop`, and optional worktree isolation. The proposed adapter
would preserve that model-visible surface while allowing an agent definition
to run through an ACP session instead of only through the current in-process
runtime.

```text
agent
  │
  ├── existing in-process backend
  └── experimental ACP backend
          └── configured stdio ACP agent

list_agents / send_message / task_stop
  └── continue to address the ordinary Qwen task
```

The first built-in target can reuse the existing ACP bridge's Qwen stdio
child-channel factory. The adapter contract should use the minimum standard
ACP subset for session creation, prompt delivery, session updates, host
support for permission requests, cancellation, and prompt stop reasons. The
host would map ACP stop reasons plus RPC, cancellation, and transport failures
into ordinary Qwen task states. Qwen-specific extensions should remain
optional and explicitly labeled.

The first slice could:

- select a symbolic built-in Qwen ACP target through an ordinary agent
  definition, without exposing arbitrary command execution;
- support foreground and background prompts through the existing `agent`
  semantics;
- associate the ACP session with the existing Qwen task ID;
- project output, permission requests, cancellation, failures, and completion
  onto that task;
- queue `send_message` input received during an active prompt and submit it as
  the next prompt;
- retain the child and ACP session for the ordinary task's continuation window,
  so a completed task can receive another prompt;
- preserve existing worktree ownership and cleanup rules;
- keep the in-process backend as the default; and
- run the adapter contract against both the built-in Qwen target and a minimal
  fake ACP agent.

Only stdio is requested initially. External commands, additional transports,
cross-process recovery, generic model selection, mid-prompt steering, and
write-ownership changes can remain follow-up work.

If the retained child exits, the transport is lost, or the ordinary task is
evicted, continuation should return an explicit unavailable outcome. The first
slice does not need `session/load` or transparent session reconstruction.

## Why is this needed?

The existing in-process backend is a good default for lightweight delegation.
An ACP adapter would give users an opt-in process-backed ordinary task whose
transport failure and cancellation can settle independently from the parent's
in-process runtime. It would also prove that Qwen's existing ordinary-agent
lifecycle can host a protocol-backed session without creating another
task-control API.

It would also provide a narrow path toward heterogeneous agent execution. The
parent would continue to use Qwen's ordinary agent semantics, while the
execution adapter translates one Qwen task into one ACP session.

Keeping the existing lifecycle is important because otherwise a new ACP tool
would duplicate capabilities Qwen already has:

- foreground and background delivery;
- stable task IDs and discovery;
- follow-up and revival;
- cancellation;
- completion notifications; and
- worktree isolation.

The useful new capability is the ACP execution backend, not a second set of
agent-management tools.

The boundary would also make backend behavior directly testable:

- a transport failure cannot be reported as successful completion;
- permission requests remain attributed to the correct task;
- two concurrent ACP tasks cannot cross-attribute updates;
- unsupported target behavior returns an explicit outcome; and
- in-process and ACP tasks use the same model-visible status vocabulary.

## Additional context

This is related to #10078, which proposes a backend-neutral session boundary
for Agent Teams and Agent View. The requests may be able to share a core
session interface or event vocabulary, but they have different owners:

- #10078 concerns teammates governed by `TeamManager`.
- This request concerns ordinary tasks governed by the existing agent task
  registry.

#8775 also proposes a `SessionRuntime` direction spanning ACP and `AgentCore`.
The implementation should reuse or extend the maintainer-selected seam from
#10078 or #8775, or a smaller shared lifecycle layer, rather than introduce a
third parallel session abstraction.

ACP should remain a vertical execution adapter. It should not become the
horizontal Agent Team protocol for membership, shared tasks, mailboxes, peer
routing, budgets, or cancellation policy.

This also differs from #8545. That issue concerns exposing Qwen's in-process
subagents to an external ACP client. This request concerns the reverse
direction: Qwen acts as the ACP client and uses an ACP agent as the execution
backend for an ordinary delegated task.

#8105 tracks background lifecycle and recovery for Dynamic Workflows. This
request does not add another background control plane; it reuses the ordinary
agent task registry.

Security and capability limits:

- ACP is not a sandbox.
- ACP client filesystem methods do not make an unsandboxed child read-only.
- A subprocess or worktree still runs with the user's OS permissions.
- Generic ACP does not guarantee model selection, effective-model reporting,
  mid-prompt steering, resume after transport loss, or complete command and
  changed-file evidence.
- An arbitrary external-command adapter needs an explicit command,
  environment, credential, workspace, and sandbox trust policy.

Suggested acceptance criteria:

- An ordinary agent definition can select an experimental stdio ACP backend.
- The initial built-in target runs Qwen through the existing ACP bridge.
- Foreground/background behavior remains available through `agent`.
- `list_agents`, `send_message`, and `task_stop` continue to address the
  ordinary task. Active-prompt messages are queued for the next prompt, and
  continuation after child loss or task eviction fails explicitly.
- Session updates, permissions, cancellation, failures, and terminal state are
  associated with the correct task.
- ACP stop reasons plus RPC, cancellation, and transport failures map into the
  existing Qwen task-state vocabulary.
- Transport loss is not reported as successful completion.
- Existing worktree behavior remains unchanged.
- The in-process backend remains the default.
- The minimum adapter contract passes against a generic fake ACP agent.
- The implementation reuses the maintainer-selected session/backend seam
  rather than creating a third parallel session contract.

Full design:

https://github.com/netbrah/qwen-code-upstream-pr/blob/design/agent-team-durable-runtime/docs/design/2026-08-26-acp-delegated-agent-sessions.md

<details>
<summary>中文</summary>

### 希望新增什么？

建议在 Qwen Code 现有普通 agent 生命周期后面增加一个实验性的 stdio ACP
执行 adapter。

普通 agent 已经支持前台/后台执行、task identity、`list_agents`、通过
`send_message` 继续任务、通过 `task_stop` 取消任务，以及可选的 worktree
隔离。建议保留这些模型可见接口，同时允许 agent definition 选择通过 ACP
session 执行，而不只使用当前 in-process runtime。

```text
agent
  │
  ├── 现有 in-process backend
  └── 实验性 ACP backend
          └── 已配置的 stdio ACP agent

list_agents / send_message / task_stop
  └── 继续使用普通 Qwen task 作为寻址对象
```

第一版内置目标可以复用现有 ACP bridge 的 Qwen stdio child-channel factory。
adapter contract 应只依赖标准 ACP 的最小子集，包括 session 创建、prompt
投递、session update、host 对权限请求的支持、取消和 prompt stop reason。
host 负责把 ACP stop reason 以及 RPC、取消和 transport failure 映射为普通
Qwen task 状态。Qwen 特有 extension 应保持可选并明确标注。

第一阶段可以：

- 通过普通 agent definition 选择内置的 Qwen ACP symbolic target，不暴露任意
  command execution；
- 使用现有 `agent` 语义支持前台和后台 prompt；
- 把 ACP session 与现有 Qwen task ID 关联；
- 把输出、权限请求、取消、失败和完成状态投影到该 task；
- 把当前 prompt 执行期间收到的 `send_message` 输入排队，并作为下一个
  prompt 提交；
- 在普通 task 的 continuation window 内保留 child 与 ACP session，使已完成
  的 task 可以继续接收 prompt；
- 保持现有 worktree 所有权和 cleanup 规则；
- 继续以 in-process backend 为默认；以及
- 针对内置 Qwen target 和最小 fake ACP agent 运行相同的 adapter contract
  test。

第一阶段只请求 stdio。外部命令、其他 transport、跨进程恢复、通用模型选择、
当前 prompt 执行期间的 steering 和 writer ownership 变化都可以作为后续工作。

如果保留的 child 退出、transport 丢失或普通 task 已被 evict，continuation
应返回明确的 unavailable 结果。第一阶段不需要 `session/load` 或透明地重建
session。

### 为什么需要？

现有 in-process backend 很适合作为轻量委派的默认实现。ACP adapter 可以提供
可选的 process-backed 普通 task，使 transport failure 和 cancellation 能够
独立于父 agent 的 in-process runtime 完成结算。它还可以证明 Qwen 现有普通
agent 生命周期能够承载 protocol-backed session，而不引入另一套 task control
API。

它还提供一条范围较窄的异构 agent 执行路径。父 agent 继续使用 Qwen 的普通
agent 语义，执行 adapter 负责把一个 Qwen task 翻译为一个 ACP session。

保留现有生命周期非常重要，否则新的 ACP 工具会重复 Qwen 已有的能力：

- 前台和后台交付；
- 稳定 task ID 与 discovery；
- follow-up 与 revival；
- cancellation；
- completion notification；以及
- worktree isolation。

真正新增的能力是 ACP execution backend，而不是第二套 agent management
工具。

该边界还可以直接测试 backend 行为：

- transport failure 不能被报告为成功完成；
- permission request 保持与正确 task 关联；
- 两个并发 ACP task 的 update 不能串台；
- 目标不支持的行为返回明确结果；以及
- in-process 和 ACP task 使用相同的模型可见状态词汇。

### 补充信息

该请求与 #10078 相关。#10078 建议为 Agent Team 与 Agent View 增加
backend-neutral session 边界。两项请求可能可以共享 core session interface
或 event vocabulary，但所有者不同：

- #10078 关注由 `TeamManager` 管理的 teammate。
- 本请求关注由现有 agent task registry 管理的普通 task。

#8775 也提出了跨 ACP 与 `AgentCore` 的 `SessionRuntime` 方向。实现应复用或扩展
#10078 或 #8775 中由 maintainer 选择的 seam，或更小的共享 lifecycle layer，
而不是引入第三套平行 session abstraction。

ACP 应保持为纵向执行 adapter，不应成为 Agent Team 在 membership、共享任务、
mailbox、peer routing、budget 或 cancellation policy 上使用的横向协议。

本请求也不同于 #8545。#8545 关注的是把 Qwen 的 in-process subagent 暴露给
外部 ACP client。本请求是相反方向：Qwen 作为 ACP client，把 ACP agent 用作
普通委派任务的执行 backend。

#8105 跟踪 Dynamic Workflows 的后台生命周期与恢复。本请求不增加新的后台
control plane，而是复用普通 agent task registry。

安全与能力边界：

- ACP 不是 sandbox。
- ACP client 的文件系统方法不能让未受 sandbox 限制的子进程变成只读。
- subprocess 或 worktree 仍使用用户的 OS 权限。
- 通用 ACP 不保证模型选择、effective model 报告、当前 prompt 执行期间的
  steering、transport 中断后的 resume，或完整的命令与变更文件证据。
- 任意 external-command adapter 都需要明确的 command、environment、
  credential、workspace 和 sandbox trust policy。

建议验收标准：

- 普通 agent definition 可以选择实验性的 stdio ACP backend。
- 第一版内置目标通过现有 ACP bridge 运行 Qwen。
- 前台/后台行为继续通过 `agent` 提供。
- `list_agents`、`send_message` 和 `task_stop` 继续寻址普通 task。当前 prompt
  执行期间的消息会排队到下一个 prompt；child 丢失或 task 被 evict 后的
  continuation 会明确失败。
- session update、权限、取消、失败和终止状态与正确的 task 关联。
- ACP stop reason 以及 RPC、取消和 transport failure 会映射到现有 Qwen task
  state vocabulary。
- transport loss 不会被报告为成功完成。
- 现有 worktree 行为保持不变。
- in-process backend 继续作为默认。
- 最小 adapter contract 可以通过 generic fake ACP agent 测试。
- 实现会复用 maintainer 选择的 session/backend seam，而不是创建第三套平行
  session contract。

完整设计：

https://github.com/netbrah/qwen-code-upstream-pr/blob/design/agent-team-durable-runtime/docs/design/2026-08-26-acp-delegated-agent-sessions.md

</details>
