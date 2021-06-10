import * as fs from'fs';
import * as yaml from'js-yaml';



async function generateNewCfnRootStack( context ){
    await context.amplify.generateNestedCfnStack(context);
}

export const run = async context => {
    //await context.amplify.showCfnDiff();
    const toBeDeployedCfn = await generateNewCfnRootStack(context)
    console.log("SACPCDEBUG: toBeDeployedCfn: ",  toBeDeployedCfn)
};