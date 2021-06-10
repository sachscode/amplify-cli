
export const run = async context => {
    //await context.amplify.showCfnDiff();
    const toBeDeployedCfn = await context.amplify.generateResourceStackDiff(context);
    console.log("SACPCDEBUG: toBeDeployedCfn: ",  toBeDeployedCfn)
};