/**
 * Created by xiaohe on 2016/12/12.
 */
/**
 * Create a patch document that contains all the information needed to bring the destination data into synchronization with the source data.
 *
 * The patch document looks like this: (little Endian)
 * 4 bytes - blockSize
 * 4 bytes - number of patches
 * 4 bytes - number of matched blocks
 * For each matched block:
 *   4 bytes - the index of the matched block
 * For each patch:
 *   4 bytes - last matching block index. NOTE: This is 1 based index! Zero indicates beginning of file, NOT the first block
 *   4 bytes - patch size
 *   n bytes - new data
 */
function createPatchDocument(checksumDocument, data)
{
    function appendBuffer( buffer1, buffer2 ) {
        var tmp = new Uint8Array( buffer1.byteLength + buffer2.byteLength );
        tmp.set( new Uint8Array( buffer1 ), 0 );
        tmp.set( new Uint8Array( buffer2 ), buffer1.byteLength );
        return tmp.buffer;
    }

    /**
     * First, check to see if there's a match on the 16 bit hash
     * Then, look through all the entries in the hashtable row for an adler 32 match.
     * Finally, do a strong md5 comparison
     */
    function checkMatch(adlerInfo, hashTable, block)
    {
        var hash = hash16(adlerInfo.checksum);
        if(!(hashTable[hash])) return false;
        var row = hashTable[hash];
        var i=0;
        var matchedIndex=0;

        for(i=0; i<row.length; i++)
        {
            //compare adler32sum
            if(row[i][1] != adlerInfo.checksum) continue;
            //do strong comparison
            md5sum1 = md5(block);
            md5sum1 = new Uint32Array([md5sum1[0],md5sum1[1],md5sum1[2],md5sum1[3]]); //convert to unsigned 32
            md5sum2 = row[i][2];
            if(
                md5sum1[0] == md5sum2[0] &&
                md5sum1[1] == md5sum2[1] &&
                md5sum1[2] == md5sum2[2] &&
                md5sum1[3] == md5sum2[3]
            )
                return row[i][0]; //match found, return the matched block index

        }

        return false;

    }

    var checksumDocumentView = new Uint32Array(checksumDocument);
    var blockSize = checksumDocumentView[0];
    var numBlocks = checksumDocumentView[1];
    var numPatches = 0;

    var patchDocument = new ArrayBuffer(12);
    var patch;
    var patches = new ArrayBuffer(0);
    var i=0;

    var hashTable = parseChecksumDocument(checksumDocument);
    var endOffset = data.byteLength - blockSize;
    var adlerInfo = null;
    var lastMatchIndex = 0;
    var currentPatch = new ArrayBuffer(1000);
    var currentPatchUint8 = new Uint8Array(currentPatch);
    var currentPatchSize = 0;
    var dataUint8 = new Uint8Array(data);
    var matchedBlocks = new ArrayBuffer(1000);
    var matchedBlocksUint32 = new Uint32Array(matchedBlocks);
    var matchCount = 0;


    for(;;)
    {
        var chunkSize = 0;
        //determine the size of the next data chuck to evaluate. Default to blockSize, but clamp to end of data
        if((i + blockSize) > data.byteLength)
        {
            chunkSize = data.byteLength - i;
            adlerInfo=null; //need to reset this because the rolling checksum doesn't work correctly on a final non-aligned block
        }
        else
            chunkSize = blockSize;

        if(adlerInfo)
            adlerInfo = rollingChecksum(adlerInfo, i, i + chunkSize - 1, dataUint8);
        else
            adlerInfo = adler32(i, i + chunkSize - 1, dataUint8);

        var matchedBlock = checkMatch(adlerInfo, hashTable, new Uint8Array(data,i,chunkSize));
        if(matchedBlock)
        {
            //if we have a match, do the following:
            //1) add the matched block index to our tracking buffer
            //2) check to see if there's a current patch. If so, add it to the patch document.
            //3) jump forward blockSize bytes and continue
            matchedBlocksUint32[matchCount] = matchedBlock;
            matchCount++;
            //check to see if we need more memory for the matched blocks
            if(matchCount >= matchedBlocksUint32.length)
            {
                matchedBlocks = appendBuffer(matchedBlocks, new ArrayBuffer(1000));
                matchedBlocksUint32 = new Uint32Array(matchedBlocks);
            }
            if(currentPatchSize > 0)
            {
                //create the patch and append it to the patches buffer
                patch = new ArrayBuffer(4 + 4); //4 for last match index, 4 for patch size
                var patchUint32 = new Uint32Array(patch,0,2);
                patchUint32[0] = lastMatchIndex;
                patchUint32[1] = currentPatchSize;
                patch = appendBuffer(patch,currentPatch.slice(0,currentPatchSize));
                patches = appendBuffer(patches, patch);
                currentPatch = new ArrayBuffer(1000);
                currentPatchUint8 = new Uint8Array(currentPatch);
                currentPatchSize = 0;
                numPatches++;
            }
            lastMatchIndex = matchedBlock;
            i+=blockSize;
            if(i >= dataUint8.length -1 ) break;
            adlerInfo=null;
            continue;
        }
        else
        {
            //while we don't have a block match, append bytes to the current patch
            currentPatchUint8[currentPatchSize] = dataUint8[i];
            currentPatchSize++;
            if(currentPatchSize >= currentPatch.byteLength)
            {
                //allocate another 1000 bytes
                currentPatch = appendBuffer(currentPatch, new ArrayBuffer(1000));
                currentPatchUint8 = new Uint8Array(currentPatch);
            }
        }
        if((i) >= dataUint8.length -1) break;
        i++;
    } //end for each byte in the data
    if(currentPatchSize > 0)
    {
        //create the patch and append it to the patches buffer
        patch = new ArrayBuffer(4 + 4); //4 for last match index, 4 for patch size
        var patchUint32 = new Uint32Array(patch,0,2);
        patchUint32[0] = lastMatchIndex;
        patchUint32[1] = currentPatchSize;
        patch = appendBuffer(patch,currentPatch.slice(0,currentPatchSize));
        patches = appendBuffer(patches, patch);
        numPatches++;
    }

    var patchDocumentView32 = new Uint32Array(patchDocument);
    patchDocumentView32[0] = blockSize;
    patchDocumentView32[1] = numPatches;
    patchDocumentView32[2] = matchCount;
    patchDocument = appendBuffer(patchDocument, matchedBlocks.slice(0,matchCount * 4));
    patchDocument = appendBuffer(patchDocument, patches);

    var patchDocumentView32 = new Uint32Array(patchDocument,0,matchCount + 3);
    var patchDocumentView8 = new Uint8Array(patchDocument);

    return patchDocument;
}