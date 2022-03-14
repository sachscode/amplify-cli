
import { CloudFormationClient, GetTemplateCommand, UpdateStackCommand, UpdateStackCommandInput, DescribeStackDriftDetectionStatusCommand,
    DetectStackDriftCommand, DescribeStackResourceDriftsCommandOutput,ListStackResourcesCommand, waitUntilStackUpdateComplete,
    GetTemplateSummaryCommand, GetTemplateSummaryCommandInput, GetTemplateSummaryCommandOutput,
    DescribeStackResourcesCommand, DescribeStackResourcesCommandInput, DescribeStackResourcesCommandOutput,
    DescribeStackResourceDriftsCommand, DescribeStackResourceDriftsCommandInput,
ListStacksCommand, ListStacksCommandInput, ListStacksCommandOutput, GetTemplateCommandInput, DescribeStacksCommand, Parameter} from "@aws-sdk/client-cloudformation";

import { WaiterConfiguration, WaiterResult, WaiterState } from "@aws-sdk/util-waiter";


import { DescribeStackDriftDetectionStatusOutput } from 'aws-sdk/clients/cloudformation';
import { $TSAny, $TSContext, stateManager } from 'amplify-cli-core';
import ora from 'ora';
import * as emoji from "node-emoji";
import chalk from "chalk";
import terminalLink from 'terminal-link';
import { prompter, printer } from "amplify-prompts";
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import fs from 'fs-extra';
const jsonpatch = require('fast-json-patch');

const spinner = ora('');
/**
 * Async function to query all stack ids in the Amplify project and print their differences.
 * @returns Promise<DescribeStackDriftDetectionStatusOutput>
 */
export async function getCloudFormationStackDrift() :  Promise<DescribeStackDriftDetectionStatusOutput[]> {
    const cfnMeta = getCFNMeta();
    const client = new CloudFormationClient({region: cfnMeta.Region});
    const driftDetectionOuputList = await detectCFNStackDrift(cfnMeta, client);
    const stackDiffList :any[] = [];
    for (const driftDetectionOutput of driftDetectionOuputList ){
        const command = new DescribeStackDriftDetectionStatusCommand( {StackDriftDetectionId : driftDetectionOutput.StackDriftDetectionId } );
        spinner.start(`Calling Drift check with retry ${driftDetectionOutput.StackName}`);
        let response;
        let tryNum = 0;
        do  {
          response = await client.send(command);
          spinner.color = 'yellow';
	      spinner.text = `Waiting ${(2 ** tryNum * 10)/1000} secs for Drift check to complete ${driftDetectionOutput.StackName}`;
          await wait(2 ** tryNum * 10);
          tryNum++;
        } while(response.DetectionStatus === "DETECTION_IN_PROGRESS")

        if(response.StackDriftStatus == "DRIFTED" ){
            spinner.warn(`Drift Detected on Stack: ${driftDetectionOutput.StackName} ${emoji.get('warning')}`);
            const stackDiffs = await getAllResourceStackDrift( driftDetectionOutput.StackName, client );
            stackDiffList.push( stackDiffs );
        } else {
            spinner.succeed(`Stack : ${driftDetectionOutput.StackName} is pristine`);
        }
    }

    const driftResults = stackDiffList.flat(2);
    return driftResults;
}

export async function viewAnalyzeDriftResults(context:$TSContext, driftResults: Array<DescribeStackDriftDetectionStatusOutput>){
    if (driftResults?.length <= 0 ){
        return;
    }
    const showMitigation =  await viewQuestionDriftDetectionAnalysis(context);
    if ( showMitigation ){
        analyzeCFNDriftResult(context, driftResults)
    }
}

export async function analyzeCFNDriftResult(context, driftResults){
    console.log("SACPCDEBUG: analyzeCFNDriftResult: ", JSON.stringify(driftResults, null, 2));
    printer.warn("The following changes will be applied to the application resources in the cloud...");
    for ( const result of driftResults ){
        console.log(`Fix Resource:: ${result.ResourceType} physical id :: ${chalk.cyan(result.PhysicalResourceId)}`);
        let propCount = 1;
        if ( result.StackResourceDriftStatus == "DELETED"){
            console.log(`Create ${result.ResourceType} with PhysicalID ${result.PhysicalResourceId}`)
        } else {
            for( const propDiff of result.PropertyDifferences ) {
                let remedy = (verb: string, config : any)=>
                `${propCount++}. ${verb} ${(propDiff.PropertyPath)?`Property:: ${chalk.cyan(propDiff.PropertyPath)}`:""} with config : \n${chalk.cyan(JSON.stringify(config, null, 2))}`;
                if ( propDiff.DifferenceType == "REMOVE" ){
                    const config = JSON.parse(propDiff.ExpectedValue)
                    //handle creation
                    console.log( remedy('Create', config) );
                } else if ( propDiff.DifferenceType == "NOT_EQUAL" ) {
                    //handle parameter setting
                    // console.log("Resetting drifted resource ", propDiff.ExpectedValue );
                    console.log( remedy('Update', propDiff.ExpectedValue) );
                }
            }
        }
    }
    await applyReverseDriftUpdateStack(context, driftResults);
}

function styleResourceDriftStatus( StackResourceDriftStatus : string ){
    switch(StackResourceDriftStatus){
        case 'DELETED' :  {
            return chalk.red(StackResourceDriftStatus);
        }
        case 'MODIFIED': {
            return chalk.yellow(StackResourceDriftStatus);
        }
    }
    return StackResourceDriftStatus;
}

function generateClickableURL( stackName : string, stackId : string, region: string ){
    const finalURL = buildDriftStackURL(stackId, region);
    const link = terminalLink(stackName, finalURL);
    return link;
}

function buildDriftStackURL( stackId : string, region: string ){
    const stackURL = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/drifts?`;
    const stackIDStr = `stackId=${stackId}`;
    const finalURL = `${stackURL}${stackIDStr}`;
    return finalURL;
}

function buildTemplateStackURL( stackId : string, region: string ){
    const stackURL = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/update/template?`;
    const stackIDStr = `stackId=${stackId}`;
    const finalURL = `${stackURL}${stackIDStr}`;
    return finalURL;
}

function tabulateDriftResults( results:any[]){
    const cfnMeta = getCFNMeta();
    const tableHeader = [["LogicalResourceId", "PhysicalResourceId","ResourceType", "Status", "Timestamp", "Stack Name"]];
    const tableRows = results.map( result => {
        return [result.LogicalResourceId, result.PhysicalResourceId,
                result.ResourceType, styleResourceDriftStatus(result.StackResourceDriftStatus),
                formatTimeStamp(result.Timestamp), generateClickableURL(result.StackName , result.StackId, cfnMeta.Region)]
    });
    const tableOptions = [...tableHeader, ...tableRows];
    return tableOptions;
}

function formatTimeStamp(datetimestamp : string){
    const date = new Date(datetimestamp);
    const day = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();
    const minutes = date.getMinutes();
    const hours = date.getHours();
    const seconds = date.getSeconds();
    return (monthIndex+1)+"-"+day+"-"+year+" "+ hours+":"+minutes+":"+seconds;
}

export async function viewCloudFormationDriftResults( context: $TSContext , results: DescribeStackDriftDetectionStatusOutput[] ){
    if ( results.length > 0 ) {
        const title = " Manual Changes detected in the cloud!!"
        printer.info('');
        printer.warn(title);
        const tableOptions = tabulateDriftResults(results);
        context.print.table(tableOptions,  { format: 'lean' });
        printer.info('');
    } else {
        printer.success(" No manual changes detected in the cloud")
    }
}

export async function viewQuestionDriftDetection(context: $TSContext){
    return await prompter.yesOrNo('Would you like to check if any resources have been manually changed in the cloud?');
}

export async function viewQuestionDriftDetectionAnalysis(context: $TSContext){
    return await prompter.yesOrNo('Would you like to analyze the drifted resources?');
}

export async function getAllResourceStackDrift( StackName : string, client: CloudFormationClient ){
    const maxResults = 100; //max cloudformation stacks
    let responses: $TSAny[] = [];
    for await (let response of getResourceStackDriftGenerator( client, StackName, maxResults )) {
        if ( response ){
            responses.push(response.StackResourceDrifts);
        }
    }
    return responses;
}

async function getListStacks( client : CloudFormationClient, stackPrefix : string, onlyFailed?: boolean ){
    //use this filter when only failed deployments need to be tested for drift
    const stackStatusFilter = [
      "CREATE_FAILED", "ROLLBACK_IN_PROGRESS", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE", "DELETE_FAILED",
      "UPDATE_FAILED", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_FAILED",
      "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE",
      "IMPORT_ROLLBACK_IN_PROGRESS","IMPORT_ROLLBACK_FAILED", "IMPORT_ROLLBACK_COMPLETE"
      /* more items */
    ]
    const params : ListStacksCommandInput = (onlyFailed)?{ StackStatusFilter : stackStatusFilter } : {}
    const command = new ListStacksCommand(params);
    const response : ListStacksCommandOutput = await client.send(command);
    const filteredStacks = response.StackSummaries?.filter( stackSummary => stackSummary.StackName?.includes(stackPrefix))||[]
    return filteredStacks;
}

function getCFNMeta(): $TSAny {
    const amplifyMeta = stateManager.getMeta();
    return amplifyMeta.providers.awscloudformation;
}

async function displayStyledStackDiff(stackDiffs){
    for ( const stack of stackDiffs ){
        for ( const stackDrift of stack.StackResourceDrifts ) {
            console.log(`LogicalID : ${stackDrift.LogicalResourceId}  PhysicalID : ${stackDrift.PhysicalResourceId} ResourceType : ${stackDrift.ResourceType}`);
            console.log(JSON.stringify(stackDrift.PropertyDifferences, null, 2));
        }
    }
}

async function detectCFNStackDrift(cfnMeta: $TSAny , client: CloudFormationClient) {
    const failedStackList = await getListStacks( client, cfnMeta.StackName );
    const uniqueStackNames =  [ ...new Set([cfnMeta.StackName, ...failedStackList.map( stackEntry => stackEntry.StackName)])];
    let failedStackIdentityList :any[]= [];
    failedStackList.map( failedStack => {
                                    if (failedStack.StackName && !( failedStack.StackName in uniqueStackNames)){
                                        failedStackIdentityList.push({
                                            StackName: failedStack.StackName ,
                                            StackID : failedStack.StackId
                                          })
                                    }
                                });


    const driftPendingResponseList  =  failedStackIdentityList.map( async failedStackIdentity => {
        const input = { StackName: failedStackIdentity.StackName };
        const command = new DetectStackDriftCommand(input);
        let response  = await client.send(command);
        return {...response, StackName: failedStackIdentity.StackName };
    })
    const driftResponseList = Promise.all( driftPendingResponseList )
    return driftResponseList;
}

async function* getResourceStackDriftGenerator( client : CloudFormationClient, stackName : string, maxResults: number ){
    let params : DescribeStackResourceDriftsCommandInput = {
    StackName: stackName,
    MaxResults: maxResults,
    StackResourceDriftStatusFilters: ["MODIFIED", "DELETED"]
    };

    let response:DescribeStackResourceDriftsCommandOutput ;
    do {
        const command = new DescribeStackResourceDriftsCommand( params );
        response = await client.send(command);
        if (response.StackResourceDrifts) {
            const normalizedStackResourceDrifts = response.StackResourceDrifts.map( s => ({...s, StackName: stackName }));
            response.StackResourceDrifts = normalizedStackResourceDrifts;
        }
        yield response;
        params.NextToken = (response)?response.NextToken:undefined;
    } while( response?.NextToken );
}

/********************** Apply reverse drift to stack and update ****************************/

async function applyReverseDriftUpdateStack(context, driftResults){
    const tmpFolderPath = buildTempAmplifyFolder(context);
    printer.info("fixing drift: downloading stacks to be updated...");
    //const downloadedPath = await downloadDeployedAppFiles(context, tmpFolderPath, driftResults);
    const fixedPath = await applyDrift(context, tmpFolderPath, driftResults)
    printer.info("fixing drift: applying reverse drift to the cloud...");
    printer.info("fixing drift: drift resolved for stacks");
}

function getPatchFromPropDiff( driftResult, propDiff ){
    let patchObj : $TSAny = { op : null, path : null }
    patchObj.op = propDiff.DifferenceType.toLowerCase();
    patchObj.path = `/Resources/${driftResult.LogicalResourceId}/Properties${propDiff.PropertyPath}`;
    if ( propDiff.ActualValue != "null" ){
        console.log("PROPDIFF: ", propDiff.PropertyPath);
        patchObj.value = propDiff.ActualValue
    }
    return patchObj;
}

async function applyDrift( context , tmpFolderPath, driftResults ){
    const cfnMeta = getCFNMeta();
    for await (let response of downloadDeployedAppFiles(context, tmpFolderPath, driftResults )) {
            console.log(`Patching : ${response.driftResult.StackResourceDriftStatus}`)
            //Modification
            if ( response.driftResult.StackResourceDriftStatus ==  "MODIFIED" ) {
                let resolveDrift = JSON.parse( JSON.stringify(response) );
                if ( resolveDrift.driftResult.PropertyDifferences ){
                    const patches = resolveDrift.driftResult.PropertyDifferences.map( propDiff => getPatchFromPropDiff(resolveDrift.driftResult, propDiff) );
                    console.log("Patching: Applying patches: ", JSON.stringify(patches, null, 2));
                    //apply patches
                    try {
                        resolveDrift.templateBody = jsonpatch.applyPatch(resolveDrift.templateBody, patches).newDocument;
                    } catch(error ){
                        console.error(error);
                    };
                    fs.writeFileSync(`${resolveDrift.filename}_drift`, JSON.stringify(resolveDrift.templateBody, null,2));
                    //sync cfn-state to be equivalent to service-state
                    const updateResponse = await driftHandlerUpdateCFNStack( resolveDrift.driftResult,
                                                                             cfnMeta.Region,
                                                                             JSON.stringify(resolveDrift.templateBody),
                                                                             response.rspParams);
                    //sycn cfn-state to be equivalent to local-state
                    const resolveResponse = await driftHandlerUpdateCFNStack( response.driftResult,
                                                                              cfnMeta.Region,
                                                                              JSON.stringify(response.templateBody),
                                                                              response.rspParams);
                } else {
                    printer.error(`Malformed drift status : ${response.driftResult}`)
                }
            }
    }
    return tmpFolderPath;
}

async function  driftHandlerGetCFNStackParams( StackName: string , Region: string ){
    const client = new CloudFormationClient({region: Region});
    printer.info(`1.Params: StackID : ${StackName}`);
    const cmd = new DescribeStacksCommand({ StackName })
    console.log("2.Building TemplateSummary Command (Parameters)");
    const rsp = await client.send(cmd);
    let parameters : Parameter[] = [];
    if ( rsp&& rsp.Stacks ){
        parameters = rsp.Stacks[0].Parameters || []
    }
    return parameters;
}

async function driftHandlerGetCFNStack(StackName :string, Region:string){
    const client = new CloudFormationClient({region: Region});
    printer.info(`1.StackID : ${StackName}`);
    const cmd = new GetTemplateCommand({StackName, TemplateStage:"Processed"}) ;
    console.log("2.Building Template Command");
    const rsp = await client.send(cmd);
    return rsp;
}
async function driftHandlerUpdateCFNStack(driftResult, region:string,  TemplateBodyString: string , params :Parameter[]){
    const client = new CloudFormationClient({region: region });
    printer.info(`1.StackID : ${driftResult.StackName}`);
    const stackURL = buildTemplateStackURL( driftResult.stackId, region );
    const cmd = new UpdateStackCommand({ StackName: driftResult.StackName ,
                                         TemplateBody: TemplateBodyString ,
                                         Parameters : params,
                                         Capabilities: ['CAPABILITY_NAMED_IAM'] }) ;
    console.log("2.Updating Template Template Command");
    let rsp;
    let waitResponse;
    try {
        rsp = await client.send(cmd);
        const waitParams: WaiterConfiguration<CloudFormationClient> = {client , maxWaitTime: 60} ;
        waitResponse = await waitUntilStackUpdateComplete( waitParams, { StackName: driftResult.StackName } );
    } catch( error ){
        console.error("Template Update failed ", error);
    }
    console.log("2.Received Template Update Response", JSON.stringify(waitResponse));
    return rsp;
}


async function driftHandlerSaveCFNStack( destinationPath: string, stackName: string, templateBody: $TSAny){
    const filename = path.join(destinationPath, stackName);
    console.log("5.Saving file");
    if ( templateBody ) {
        fs.writeFileSync(filename, JSON.stringify( templateBody, null,2));
    }
    return filename
}

/**
 *
 * @param context
 * @param destinationPath  - local path where
 * @returns path to downloaded folder
 */
async function* downloadDeployedAppFiles( context : $TSContext, destinationPath : string, driftResults ){
    createFolder( destinationPath );
    const cfnMeta = getCFNMeta();
    for ( const driftResult of driftResults ) {
        const rsp = await driftHandlerGetCFNStack(driftResult.StackName, cfnMeta.Region);
        const rspParams: Parameter[] = await driftHandlerGetCFNStackParams( driftResult.StackName, cfnMeta.Region );
        const templateBody = (rsp.TemplateBody)?JSON.parse(rsp.TemplateBody):undefined;
        const filename = await driftHandlerSaveCFNStack(destinationPath, driftResult.StackName, templateBody);
        yield ({ filename, driftResult , templateBody, rspParams });
    }
    return destinationPath;
}

function createFolder(folderPath) : boolean{
    try {
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath)
          return true;
        }
    } catch (err) {
       return false
    }
    return true;
}

/**
 * Build the path name for a temporary folder in amplify
 * @param context
 * @param prefix
 * @returns Path to temporary directory in Amplify
 */
function buildTempAmplifyFolder(context, prefix? ){
    let filePrefix = prefix;
    if( !filePrefix ){
        const [tempPrefix] = uuid().split('-');
        filePrefix = tempPrefix
    }
    const amplifyDir = context.amplify.pathManager.getAmplifyDirPath();
    const tempDirPath = path.join(amplifyDir, `.temp${filePrefix}`);
    return tempDirPath
}


function checkDriftCheckDone(result){
    if (result.DetectionStatus === "DETECTION_IN_PROGRESS"){
      return false;
    } else {
      return true;
    }
}

function wait(ms){
    return new Promise((res) => setTimeout(res, ms));
  }
  async function callWithRetry( asyncfn, args, resultChk, maxRetries = 7){
    for( let tryNum = 0 ; tryNum < maxRetries ; tryNum++ ) {
        const results = await asyncfn(args);
        if ( resultChk(results) ){
          return results;
        }
        await wait(2 ** tryNum * 10);
    }
  }

