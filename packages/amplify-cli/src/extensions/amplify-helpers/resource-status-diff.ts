
import * as fs from 'fs-extra';
import * as path from 'path';
import * as cfnDiff from '@aws-cdk/cloudformation-diff';
import * as yaml_cfn from './yaml-cfn';
import * as cxapi from '@aws-cdk/cx-api';
import { print } from './print';
import { pathManager } from 'amplify-cli-core';
import chalk from 'chalk';

const CategoryTypes = {
    PROVIDERS : "providers",
    API : "api",
    AUTH : "auth",
    STORAGE : "storage",
    FUNCTION : "function",
    ANALYTICS : "analytics"
}

const CategoryProviders = {
    CLOUDFORMATION : "cloudformation",
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

function _getResourceProviderFileName(  resourceName : string, providerType : string ){
    //resourceName is the name of an instantiated category type e.g name of your s3 bucket
    //providerType is the name of the cloud infrastructure provider e.g cloudformation/terraform
    return `${resourceName}-${providerType}-template`
  }

  function deserializeStructure(str: string): any {
    try {
      return yaml_cfn.deserialize(str);
    } catch (e) {
      return JSON.parse(str);
    }
  }

  async function loadStructuredFile(fileName: string) {
    const contents = await fs.readFile(fileName, { encoding: 'utf-8' });
    return deserializeStructure(contents);
  }

  async function loadCloudFormationTemplate( filePath ){
    try {
      //Load yaml or yml or json files
      let providerObject = {};
      const inputTypes = [ 'json', 'yaml', 'yml']
      for( let i = 0 ; i < inputTypes.length ; i++ ){
        if ( fs.existsSync(`${filePath}.${inputTypes[i]}`) ){
          providerObject = await loadStructuredFile(`${filePath}.${inputTypes[i]}`);
          return providerObject;
        }
      }
      return providerObject;
    } catch (e) {
      //No resource file found
      console.log(e);
      throw e;
    }
  }

  async function getObjectFromProviderFile( resourcePath, resourceName, providerType ) {
    //Read the cloudformation/terraform file
    const resourceProviderFilePath = `${resourcePath}/${_getResourceProviderFileName(resourceName, providerType)}`;
    //console.log("SACPCDEBUG:COLLATE: ", resourceProviderFilePath);
    return await loadCloudFormationTemplate( resourceProviderFilePath ) //loads json, yaml or yml files
  }

  function checkExist( filePath ){
    const inputTypes = [ 'json', 'yaml', 'yml']
    for( let i = 0 ; i < inputTypes.length ; i++ ){
      if ( fs.existsSync(`${filePath}.${inputTypes[i]}`) ){
        return true;
      }
    }
    return false;
  }

  function getLocalBackendDirPath(categoryName, resourceName){
    return path.normalize(path.join(pathManager.getBackendDirPath(), categoryName, resourceName))
 }

 function getCloudBackendDirPath(categoryName, resourceName){
   return path.normalize(path.join(pathManager.getCurrentCloudBackendDirPath(), categoryName, resourceName))
 }



function printStackDiff(
    oldTemplate: any,
    newTemplate: any,
    strict: boolean,
    stream?: cfnDiff.FormatStream): number {

    const diff = cfnDiff.diffTemplate(oldTemplate, newTemplate );

    // filter out 'AWS::CDK::Metadata' resources from the template
    if (diff.resources && !strict) {
      diff.resources = diff.resources.filter(change => {
        if (!change) { return true; }
        if (change.newResourceType === 'AWS::CDK::Metadata') { return false; }
        if (change.oldResourceType === 'AWS::CDK::Metadata') { return false; }
        return true;
      });
    }

    if (!diff.isEmpty) {
      cfnDiff.formatDifferences(stream || process.stderr, diff);
    }
    return diff.differenceCount;
  }
  const vaporStyle = chalk.hex('#8be8fd').bgHex('#282a36');

async function printAPIResourceDiff(header, provider, resource, localBackendDir, cloudBackendDir ){

    const cfnTemplateGlobPattern = '*template*.+(yaml|yml|json)';
    //API artifacts are stored in build folder for cloud resources
    const cloudBuildTemplateFile = path.normalize(path.join(cloudBackendDir, "build/cloudformation-template"));
    const localBuildTemplateFile =  path.normalize(path.join(localBackendDir, "build/cloudformation-template"));
    //SACPCTBD!!: This should not rely on the presence or absence of a file, it should be based on the context state.
    //e.g user-added, amplify-built-not-deployed, amplify-deployed-failed, amplify-deployed-success
    const localAPIFile = (checkExist(localBuildTemplateFile))?localBuildTemplateFile:`${localBackendDir}/${_getResourceProviderFileName(resource.resourceName, provider)}`;
    const cloudAPIFile = (checkExist(cloudBuildTemplateFile))?cloudBuildTemplateFile :  `${cloudBackendDir}/${_getResourceProviderFileName(resource.resourceName, provider)}`

    //diff all cloudformation
    const cloudTemplate:any = await loadCloudFormationTemplate( cloudAPIFile );
    const localUpdatedTemplate:any = await loadCloudFormationTemplate( localAPIFile ); //exists if deployed once.

    print.info(`[\u27A5] ${vaporStyle("Stack: ")} ${capitalize(resource.category)}/${resource.resourceName} : ${header}`);
    const diffCount = printStackDiff( cloudTemplate, localUpdatedTemplate, false /* not strict */ );
    if ( diffCount === 0 ){
       console.log("No changes  ");
    }
}

export async function CollateResourceDiffs( resources , header ){
    let count = 0;
    const provider = CategoryProviders.CLOUDFORMATION;
    resources.map( async (resource) => {
            const localBackendDir = getLocalBackendDirPath(resource.category, resource.resourceName);
            const cloudBackendDir = getCloudBackendDirPath(resource.category, resource.resourceName);
            if ( resource.category.toLowerCase() === CategoryTypes.API ){
               await printAPIResourceDiff(header, provider, resource, localBackendDir, cloudBackendDir );
            } else {
              //print cdk diff
              const localUpdatedTemplate:any = await getObjectFromProviderFile( localBackendDir,
                                                                                resource.resourceName,
                                                                                provider);
              const cloudTemplate:any = await getObjectFromProviderFile( cloudBackendDir,
                                                                        resource.resourceName,
                                                                        provider);
              //console.log("SACPCDEBUG: Diff : localTemplateFile: ", JSON.stringify(localUpdatedTemplate, null, 2),
              //                                  "cloudBackendTemplate:", JSON.stringify(cloudTemplate, null, 2) );
              print.info(`[\u27A5] ${vaporStyle("Stack: ")} ${capitalize(resource.category)}/${resource.resourceName} : ${header}`);
              const diffCount = printStackDiff( cloudTemplate, localUpdatedTemplate, false /* not strict */ );
              if ( diffCount === 0 ){
                console.log("No changes  ")
              }
           }
      } );
  }


