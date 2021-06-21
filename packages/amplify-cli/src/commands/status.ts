function normalizeCategory( category: string | null | undefined ){
     if( category ){
       return category.toLowerCase();
     } else {
       return undefined;
     }
}
export const run = async context => {
  const category = normalizeCategory( context.input.options?.category );
  const resource = context.input.options?.resource;
  await context.amplify.showResourceTable(category, resource);
  await context.amplify.showHelpfulProviderLinks(context);
  await showAmplifyConsoleHostingStatus(context);
};

async function showAmplifyConsoleHostingStatus(context) {
  const pluginInfo = context.amplify.getCategoryPluginInfo(context, 'hosting', 'amplifyhosting');
  if (pluginInfo && pluginInfo.packageLocation) {
    const { status } = require(pluginInfo.packageLocation);
    if (status) {
      await status(context);
    }
  }
}
