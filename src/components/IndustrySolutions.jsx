import React from 'react'
import { 
  Video, 
  ShoppingBag, 
  Cpu, 
  Stethoscope, 
  UtensilsCrossed, 
  HardHat, 
  TrendingUp 
} from 'lucide-react'
import './IndustrySolutions.css'

const SolutionsSection = () => {
  const solutions = [
    {
      icon: Video,
      title: '直播行业',
      desc: '直播行业解决方案',
      detail: '直播行业的本质是人才与合规的双重竞争，作为数字经济的重要赛道，用工风险异常突出。直击直播行业劳动关系认定困境、合同陷阱与纠纷、工时与薪酬争议纠纷、社保合规风险以及知识产权风险等痛点，减少人力资源合规成本，违规用工罚款清零，提高主播留存率。'
    },
    {
      icon: ShoppingBag,
      title: '新消费行业',
      desc: '新消费行业解决方案',
      detail: '新消费行业（美妆、新茶饮等）面临"高频流动+分散管理+混合用工+工时波动"的独特挑战。劳动争议逐年增长。通过用工风险防控为新消费企业构建全链路风险防护网。直击新消费行业劳动关系认定困境、高流动率违纪、社保合规盲区、薪酬结构混乱等痛点。为企业降本增效，优化用工结构，提升管理效率。'
    },
    {
      icon: Cpu,
      title: '高科技行业',
      desc: '高科技行业解决方案',
      detail: '高科技行业作为知识密集型产业，面临独特的用工风险挑战。能够为高科技行业做股权激励全生命周期管理、研发人员知识产权保护、远程/混合办公风险防控，并且能够优化合规薪酬结构、为灵活用工做合规管理。减少劳动争议案件和合规成本。提高HR处理用工事务效率，降低核心技术泄露风险并提升核心人才留存率。'
    },
    {
      icon: Stethoscope,
      title: '医疗行业',
      desc: '医疗行业解决方案',
      detail: '实现医疗行业高合规要求下的精细化管理。针对当前医疗行业医护人员流动率高。三班倒工作制普遍、劳务派遣用工广泛但合规风险高，责任划分不清等痛点，能有效降低合规风险，从而提升医护满意度。将违规用工处罚清零，降低连带责任风险。'
    },
    {
      icon: UtensilsCrossed,
      title: '服务行业',
      desc: '服务行业解决方案',
      detail: '进行弹性用工风险防控，直击餐饮、零售。酒店类服务业的痛苦，解决行业小时工占比高、用工需求波动剧烈、劳动合同管理混乱、纠纷率高。考勤数据不准确导致薪资争议的问题。有效降低人力成本、合规风险。下降考勤纠纷，提升员工留存率。比如餐饮行业通过用工调整员工排班问题，降低投诉率。从而提升客户满意度、节省人力成本。'
    },
    {
      icon: HardHat,
      title: '劳务行业',
      desc: '劳务行业解决方案',
      detail: '为劳务行业构建新业态用工风险防火墙，解决劳务行业劳动关系认定模糊，"假外包真派遣"等合规风险。直击劳务行业结算方式不规范，税务风险高。平台用工责任划分不清，发生事故时责任推诿现象普遍，跨地区用工，各地法规差异大，合规难度高的痛点。劳动关系争议有效下降，税务风险清零。跨区域合规风险显著降低。'
    },
  ]

  return (
    <section id="solutions" className="solutions-section section-scroll">
      <div className="container">
        <div className="section-header fade-in-up">
          <h2 className="section-title">行业服务案例</h2>
          <p className="section-desc">针对不同行业特点，提供专业化的用工风险防控方案</p>
        </div>
        
        <div className="solutions-grid">
          {solutions.map((solution, index) => {
            const IconComponent = solution.icon
            const delayClass = `fade-in-up-delay-${(index % 3) + 1}`
            return (
              <div key={index} className={`solution-card ${delayClass}`}>
                <div className="solution-front">
                  <div className="solution-header">
                    <div className="solution-icon">
                      <IconComponent size={24} />
                    </div>
                    <h3>{solution.title}</h3>
                  </div>
                  <p className="solution-desc">{solution.desc}</p>
                  <p className="solution-detail">{solution.detail}</p>
                  <a href="https://jsj.top/f/NctQWw" target="_blank" rel="noopener noreferrer" className="solution-link">了解更多</a>
                </div>
              </div>
            )
          })}
        </div>
        
        <div className="section-cta">
          <a className="primary-btn" href="https://jsj.top/f/NctQWw" target="_blank" rel="noopener noreferrer">免费咨询</a>
        </div>
      </div>
    </section>
  )
}

export default SolutionsSection

