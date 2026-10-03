.PHONY: install frontend build reset

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 灭菌验证环境复位：核对依赖 → 按台账铺灭菌验证示例 → 成品检验归零 → 版本自增（旧浏览器存储自动作废）
reset:
	cd frontend && npm run reset:sterilize
