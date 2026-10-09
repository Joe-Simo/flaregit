import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {planningDistribution} from '../src/core/planning-distribution';
import {PlanningProgress} from '../src/web/components/PlanningProgress';
import type {Project} from '../src/core/project-planning';
const item=(issueNumber:number,status:string)=>({issueNumber,status,version:1,fields:{}});
test('planning distribution counts exact stored references without assigning done meaning to owner-defined columns',()=>{
 const project:Project={statuses:['Review','Blocked','__proto__'],fieldTypes:{},items:[item(1,'Review'),item(2,'Blocked'),item(3,'Review'),item(4,'__proto__')]};
 expect(planningDistribution(project)).toEqual({total:4,statuses:[{status:'Review',count:2,percentage:50},{status:'Blocked',count:1,percentage:25},{status:'__proto__',count:1,percentage:25}]});
 expect(planningDistribution({...project,items:[...project.items,item(5,'Historical status')]}).statuses.at(-1)).toMatchObject({status:'Historical status',count:1,percentage:20});
 const html=renderToStaticMarkup(<PlanningProgress project={project}/>);expect(html).toContain('Review: 2 of 4 planned issues (50%)');expect(html).toContain('Blocked: 1 of 4 planned issues (25%)');expect(html.match(/role="img"/g)).toHaveLength(3);expect(html).not.toContain('completed');
});
test('empty planning chart reports absence of active items and never displays fabricated percentages',()=>{
 const project:Project={statuses:['Todo','Done'],fieldTypes:{},items:[]};expect(planningDistribution(project).statuses.every(row=>row.percentage===0&&row.count===0)).toBe(true);const html=renderToStaticMarkup(<PlanningProgress project={project}/>);expect(html).toContain('No active planning items.');expect(html).not.toContain('role="img"');expect(html).not.toContain('NaN');
});
