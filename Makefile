# todopi harness —— 所有仓库操作的单一入口。
# 契约见 docs/harness/verification.md；操作手册见 AGENTS.md。

H := tools/harness.sh

.PHONY: help setup dev doctor status check test e2e check-arch vcr \
        activate release verify-feature clean-check ci audit

help:
	@$(H)

## 环境
setup:
	@./init.sh

dev:
	@echo "尚无应用可启动：implementation has not started。"
	@echo "下一步见 PROGRESS.md 的 Next Steps。"

doctor:
	@$(H) doctor

status:
	@$(H) status

## 验证（三层，逐层阻断）
check:
	@$(H) check

test:
	@$(H) test

e2e:
	@$(H) e2e

check-arch:
	@$(H) check-arch

ci:
	@$(H) ci

## Scope（WIP=1，状态机 not_started -> active -> passing）
vcr:
	@$(H) vcr

activate:
	@$(H) activate "$(F)"

release:
	@$(H) release "$(F)"

verify-feature:
	@$(H) verify-feature "$(F)"

## 清洁态
clean-check:
	@$(H) clean-check

## 用课程自带的校验器审计本 harness（不入库，需要网络）
audit:
	@curl -fsSL https://raw.githubusercontent.com/walkinglabs/learn-harness-engineering/main/tools/audit-harness.sh \
	  -o $(TMPDIR)audit-harness.sh \
	  || { echo "下载校验器失败（需要网络）"; exit 1; }
	@bash $(TMPDIR)audit-harness.sh .
