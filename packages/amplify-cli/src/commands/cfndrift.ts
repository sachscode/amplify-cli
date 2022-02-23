

import { CloudFormationClient, DescribeStackDriftDetectionStatusCommand,
    DetectStackDriftCommand, DescribeStackResourceDriftsCommandOutput,
    DescribeStackResourceDriftsCommand, DescribeStackResourceDriftsCommandInput,
ListStacksCommand, ListStacksCommandInput, ListStacksCommandOutput } from "@aws-sdk/client-cloudformation";
import { DescribeStackDriftDetectionStatusOutput } from 'aws-sdk/clients/cloudformation';
import { $TSAny, $TSContext, stateManager } from 'amplify-cli-core';
import ora from 'ora';
import * as emoji from "node-emoji";
import chalk from "chalk";
import terminalLink from 'terminal-link';
import { prompter, printer } from "amplify-prompts";

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

    const result = stackDiffList.flat(2);
    return result;
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

function generateClickableURL( StackName : string, StackId : string ){
    const region = "us-west-2";
    const stackURL = `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/drifts?`;
    const stackIDStr = `stackId=${StackId}`;
    const finalURL = `${stackURL}${stackIDStr}`;
    const link = terminalLink(StackName, finalURL);
    return link;
}

function tabulateDriftResults( results:any[]){
    const tableHeader = [["LogicalResourceId", "PhysicalResourceId","ResourceType", "Status", "Timestamp", "Stack Name"]];
    const tableRows = results.map( result => {
        return [result.LogicalResourceId, result.PhysicalResourceId,
                result.ResourceType, styleResourceDriftStatus(result.StackResourceDriftStatus),
                formatTimeStamp(result.Timestamp), generateClickableURL(result.StackName , result.StackId)]
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

