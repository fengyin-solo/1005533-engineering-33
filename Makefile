.PHONY: install frontend build reset-demo

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 复位演示数据：灭菌验证恢复示例数据、成品检验条数归零（下次打开页面生效）
reset-demo:
	cd frontend && npm run reset:demo
