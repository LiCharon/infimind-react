// 领域 runner 目前与现有劳动咨询路由共享实现；该薄适配层让任务处理器只依赖
// workflow seam，后续可以在不改任务平台接口的情况下把路由辅助函数下沉到 service。
export { runLaborConsult } from '../routes/labor-consult.js'
